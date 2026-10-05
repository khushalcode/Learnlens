// GET /api/notifications — list current user's notifications (latest 50).
// Also lazily creates DEADLINE_REMINDER notifications for assignments due
// within 24h that the student hasn't submitted yet.

import { NextResponse } from "next/server";
import { requireAuth, errorResponse } from "@/lib/rls";
import { getUserNotifications, getUnreadCount, maybeCreateDeadlineReminders } from "@/lib/notifications";

export async function GET() {
  try {
    const user = await requireAuth();
    // Lazy deadline reminders (only meaningful for students)
    if (user.role === "STUDENT") {
      try { await maybeCreateDeadlineReminders(user.id); } catch {}
    }
    const [items, unread] = await Promise.all([
      getUserNotifications(user.id, { limit: 50 }),
      getUnreadCount(user.id),
    ]);
    return NextResponse.json({ items, unread });
  } catch (e) {
    return errorResponse(e);
  }
}
