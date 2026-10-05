// PATCH /api/notifications/{id}/read — mark a single notification as read.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, errorResponse } from "@/lib/rls";
import { markAsRead } from "@/lib/notifications";
import { db } from "@/lib/db";

export async function PATCH(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const { id } = await ctx.params;

    // Verify ownership before marking
    const notif = await db.notification.findUnique({ where: { id }, select: { userId: true } });
    if (!notif) return new NextResponse("Not found", { status: 404 });
    if (notif.userId !== user.id) return new NextResponse("Forbidden", { status: 403 });

    await markAsRead(id, user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
