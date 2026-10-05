// Row-Level Security helpers — mimic Supabase RLS at the API route layer.
// Every user-scoped read/write must verify ownership + role.

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: string;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  return (session?.user as SessionUser) ?? null;
}

export interface RoleCheckResult {
  ok: boolean;
  response?: Response;
  user?: SessionUser;
}

/**
 * Require any authenticated session.
 * Returns { ok: true, user } or { ok: false, response }.
 */
export async function requireAuth(): Promise<RoleCheckResult> {
  const user = await getSessionUser();
  if (!user) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    };
  }
  return { ok: true, user };
}

/**
 * Require one of the listed roles.
 * Accepts (session, role) for backward compatibility with existing routes
 * OR () for clean calls without a session (it loads one internally).
 *
 * Returns { ok: true, user } or { ok: false, response }.
 */
export async function requireRole(
  sessionOrRole?: any,
  ...roles: string[]
): Promise<RoleCheckResult> {
  // Backward-compat: if first arg is a string, treat it as a role.
  // If it's a session object (has `.user`), use it directly.
  let user: SessionUser | null;
  let roleList: string[];

  if (typeof sessionOrRole === "string") {
    roleList = [sessionOrRole, ...roles];
    const result = await requireAuth();
    if (!result.ok) return result;
    user = result.user!;
  } else if (sessionOrRole && sessionOrRole.user) {
    user = sessionOrRole.user as SessionUser;
    roleList = roles;
  } else {
    // No session passed — treat remaining args as roles.
    roleList = roles.length ? roles : (typeof sessionOrRole === "string" ? [sessionOrRole] : []);
    const result = await requireAuth();
    if (!result.ok) return result;
    user = result.user!;
  }

  if (roleList.length && !roleList.includes(user.role)) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: `Forbidden: requires ${roleList.join(" or ")}` }),
        { status: 403, headers: { "content-type": "application/json" } }
      ),
    };
  }
  return { ok: true, user };
}

/**
 * Require self OR an elevated role.
 */
export async function requireSelfOrRole(
  userId: string,
  elevatedRoles: string[] = ["FACULTY", "ADMIN", "COORDINATOR", "MENTOR"]
): Promise<RoleCheckResult> {
  const result = await requireAuth();
  if (!result.ok) return result;
  const user = result.user!;
  if (user.id === userId || elevatedRoles.includes(user.role)) {
    return { ok: true, user };
  }
  return {
    ok: false,
    response: new Response(
      JSON.stringify({ error: "Forbidden: not the owner and not an elevated role" }),
      { status: 403, headers: { "content-type": "application/json" } }
    ),
  };
}

/**
 * Verify the student is enrolled in the course that owns this assignment.
 */
export async function verifyEnrollmentByAssignment(userId: string, assignmentId: string): Promise<boolean> {
  const assignment = await db.assignment.findUnique({
    where: { id: assignmentId },
    include: { course: { include: { enrollments: true } } },
  });
  if (!assignment) return false;
  return assignment.course.enrollments.some((e) => e.userId === userId);
}

/**
 * Convert an error with a `status` field into a Next.js Response.
 */
export function errorResponse(err: unknown): Response {
  const status = (err as { status?: number })?.status ?? 500;
  const message = err instanceof Error ? err.message : "Internal Server Error";
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
