// Notification helpers — Feature 4 (Supabase-backed).
//
// Triggers fire from existing flows: assignment create, submission, evaluation
// publish, AI analysis.
//
// We use createSupabaseAdminClient() for all writes (notify, notifyByRole,
// notifyEnrolledStudents) because notifications get created FOR other users
// (RLS only lets a user insert notifications for themselves). API routes
// already enforce auth/role at the NextAuth layer, so this is safe.
//
// For self-scoped reads (getUserNotifications, getUnreadCount) and updates
// (markAsRead, markAllAsRead) we also use the admin client for reliability —
// the API layer already ensures userId matches the session.

import { createSupabaseAdminClient } from "@/lib/supabase/server";

export type NotificationType =
  | "NEW_ASSIGNMENT"
  | "DEADLINE_REMINDER"
  | "RESULT_PUBLISHED"
  | "PEER_REVIEW_ASSIGNED"
  | "AI_ANALYSIS_READY";

// Named constants for type-safety in calling code.
export const NOTIF_TYPES = {
  NEW_ASSIGNMENT: "NEW_ASSIGNMENT" as NotificationType,
  DEADLINE_REMINDER: "DEADLINE_REMINDER" as NotificationType,
  RESULT_PUBLISHED: "RESULT_PUBLISHED" as NotificationType,
  PEER_REVIEW_ASSIGNED: "PEER_REVIEW_ASSIGNED" as NotificationType,
  AI_ANALYSIS_READY: "AI_ANALYSIS_READY" as NotificationType,
};

/**
 * Create one notification for a single user.
 */
export async function notify(
  userId: string,
  type: NotificationType,
  title: string,
  body: string,
  link?: string
): Promise<void> {
  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("notifications").insert({
      user_id: userId,
      type,
      title,
      body,
      link: link ?? null,
      read: false,
    });
    if (error) {
      console.error("[notifications] insert failed:", error.message);
    }
  } catch (e) {
    console.error("[notifications] failed to create:", e);
  }
}

/**
 * Broadcast a notification to every user with the given role.
 * Returns the count of notifications created.
 */
export async function notifyByRole(
  role: string,
  type: NotificationType,
  title: string,
  body: string,
  link?: string
): Promise<number> {
  const supabase = createSupabaseAdminClient();
  const { data: users, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", role);
  if (error || !users?.length) return 0;

  await Promise.all(users.map((u: { id: string }) => notify(u.id, type, title, body, link)));
  return users.length;
}

/**
 * Notify all students enrolled in a course (used when a new assignment is posted).
 */
export async function notifyEnrolledStudents(
  courseId: string,
  type: NotificationType,
  title: string,
  body: string,
  link?: string
): Promise<number> {
  const supabase = createSupabaseAdminClient();
  const { data: enrollments, error } = await supabase
    .from("enrollments")
    .select("user_id")
    .eq("course_id", courseId);
  if (error || !enrollments?.length) return 0;

  await Promise.all(
    enrollments.map((e: { user_id: string }) => notify(e.user_id, type, title, body, link))
  );
  return enrollments.length;
}

/**
 * Get unread count for a user.
 */
export async function getUnreadCount(userId: string): Promise<number> {
  const supabase = createSupabaseAdminClient();
  const { count, error } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("read", false);
  if (error) return 0;
  return count ?? 0;
}

/**
 * Get latest notifications for a user. Returns camelCased rows so the bell UI
 * doesn't need to change (it consumes `n.createdAt`, `n.read`, `n.userId`).
 */
export async function getUserNotifications(
  userId: string,
  opts: { limit?: number; unreadOnly?: boolean } = {}
) {
  const { limit = 50, unreadOnly = false } = opts;
  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (unreadOnly) query = query.eq("read", false);
  const { data, error } = await query;
  if (error || !data) return [];

  // Map to camelCase for backward-compat with the bell UI.
  return data.map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    read: row.read,
    createdAt: row.created_at,
  }));
}

/**
 * Mark a notification as read. Verifies ownership via the WHERE clause.
 */
export async function markAsRead(notificationId: string, userId: string): Promise<void> {
  const supabase = createSupabaseAdminClient();
  await supabase
    .from("notifications")
    .update({ read: true })
    .eq("id", notificationId)
    .eq("user_id", userId);
}

/**
 * Mark all notifications as read for a user. Returns the count updated.
 */
export async function markAllAsRead(userId: string): Promise<number> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("user_id", userId)
    .eq("read", false)
    .select("id");
  if (error) return 0;
  return data?.length ?? 0;
}

/**
 * Lazy deadline reminders — call this from the GET /api/notifications handler.
 * For each enrolled student with a pending submission and a deadline within 24h,
 * create a DEADLINE_REMINDER if one doesn't already exist for that user+assignment.
 *
 * This is a polling pattern (not a real cron) to keep the implementation simple.
 */
export async function maybeCreateDeadlineReminders(userId: string): Promise<number> {
  const supabase = createSupabaseAdminClient();
  let created = 0;
  const now = new Date();
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000); // +24h

  // Find the student's enrollments.
  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("course_id")
    .eq("user_id", userId);
  const courseIds = (enrollments ?? []).map((e: any) => e.course_id);
  if (!courseIds.length) return 0;

  // Find assignments with deadlines within 24h in those courses.
  const { data: upcomingAssignments } = await supabase
    .from("assignments")
    .select("id, title, deadline, course_id")
    .in("course_id", courseIds)
    .gte("deadline", now.toISOString())
    .lte("deadline", horizon.toISOString());

  for (const a of (upcomingAssignments ?? []) as any[]) {
    // Does the student have a submission?
    const { data: existingSub } = await supabase
      .from("submissions")
      .select("id")
      .eq("assignment_id", a.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (existingSub) continue; // already submitted — no reminder needed

    // Does a reminder already exist?
    const { data: existingReminder } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("type", "DEADLINE_REMINDER")
      .eq("link", `assignments:${a.id}`)
      .maybeSingle();
    if (existingReminder) continue;

    const hoursLeft = Math.max(
      1,
      Math.round((new Date(a.deadline).getTime() - now.getTime()) / (60 * 60 * 1000))
    );
    await notify(
      userId,
      "DEADLINE_REMINDER",
      `Assignment due soon: ${a.title}`,
      `You have ${hoursLeft}h left to submit. Don't miss the deadline!`,
      `assignments:${a.id}`
    );
    created++;
  }
  return created;
}
