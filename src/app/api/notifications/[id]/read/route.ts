// PATCH /api/notifications/{id}/read — mark a single notification as read.
//
// Fully Supabase-backed: looks up the notification via the server client
// (subject to RLS — the user can only see their own notifications, so the
// ownership check is enforced by the database policy). We still do an
// explicit ownership check in code as defense-in-depth.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, errorResponse } from "@/lib/rls";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { markAsRead } from "@/lib/notifications";

export async function PATCH(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const { id } = await ctx.params;

    // RLS ensures the user can only fetch their own notifications.
    const supabase = await createSupabaseServerClient();
    const { data: notif, error } = await supabase
      .from("notifications")
      .select("id, user_id")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[notifications PATCH] lookup error:", error);
      return new NextResponse("Internal error", { status: 500 });
    }
    if (!notif) return new NextResponse("Not found", { status: 404 });

    // Defense-in-depth ownership check
    if (notif.user_id !== user.id) return new NextResponse("Forbidden", { status: 403 });

    await markAsRead(id, user.id!);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
