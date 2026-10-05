// POST /api/notifications/read-all — mark all of the current user's notifications as read.

import { NextResponse } from "next/server";
import { requireAuth, errorResponse } from "@/lib/rls";
import { markAllAsRead } from "@/lib/notifications";

export async function POST() {
  try {
    const user = await requireAuth();
    const count = await markAllAsRead(user.id);
    return NextResponse.json({ ok: true, updated: count });
  } catch (e) {
    return errorResponse(e);
  }
}
