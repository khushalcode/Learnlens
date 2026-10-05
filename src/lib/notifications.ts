// Notification helpers — Feature 4
// Triggers fire from existing flows (assignment create, submission, evaluation publish, AI analysis).

import { db } from "@/lib/db";

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
    await db.notification.create({
      data: { userId, type, title, body, link },
    });
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
  const users = await db.user.findMany({ where: { role }, select: { id: true } });
  await Promise.all(users.map((u) => notify(u.id, type, title, body, link)));
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
  const enrollments = await db.enrollment.findMany({
    where: { courseId },
    select: { userId: true },
  });
  await Promise.all(enrollments.map((e) => notify(e.userId, type, title, body, link)));
  return enrollments.length;
}

/**
 * Get unread count for a user.
 */
export async function getUnreadCount(userId: string): Promise<number> {
  return db.notification.count({ where: { userId, read: false } });
}

/**
 * Get latest notifications for a user.
 */
export async function getUserNotifications(
  userId: string,
  opts: { limit?: number; unreadOnly?: boolean } = {}
) {
  const { limit = 50, unreadOnly = false } = opts;
  return db.notification.findMany({
    where: { userId, ...(unreadOnly ? { read: false } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/**
 * Mark a notification as read. Verifies ownership.
 */
export async function markAsRead(notificationId: string, userId: string): Promise<void> {
  await db.notification.updateMany({
    where: { id: notificationId, userId },
    data: { read: true },
  });
}

/**
 * Mark all notifications as read for a user.
 */
export async function markAllAsRead(userId: string): Promise<number> {
  const r = await db.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });
  return r.count;
}

/**
 * Lazy deadline reminders — call this from the GET /api/notifications handler.
 * For each enrolled student with a pending submission and a deadline within 24h,
 * create a DEADLINE_REMINDER if one doesn't already exist for that user+assignment.
 *
 * This is a polling pattern (not a real cron) to keep the implementation simple.
 */
export async function maybeCreateDeadlineReminders(userId: string): Promise<number> {
  let created = 0;
  const now = new Date();
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000); // +24h

  // Find assignments in courses the student is enrolled in, with deadline within 24h and not yet passed
  const enrollments = await db.enrollment.findMany({
    where: { userId },
    include: {
      course: {
        include: {
          assignments: {
            where: { deadline: { gte: now, lte: horizon } },
          },
        },
      },
    },
  });

  for (const e of enrollments) {
    for (const a of e.course.assignments) {
      // Does the student have a submission?
      const sub = await db.submission.findFirst({
        where: { assignmentId: a.id, userId },
        select: { id: true },
      });
      if (sub) continue; // already submitted — no reminder needed

      // Does a reminder already exist?
      const existing = await db.notification.findFirst({
        where: { userId, type: "DEADLINE_REMINDER", link: `assignments:${a.id}` },
        select: { id: true },
      });
      if (existing) continue;

      const hoursLeft = Math.max(1, Math.round((a.deadline.getTime() - now.getTime()) / (60 * 60 * 1000)));
      await notify(
        userId,
        "DEADLINE_REMINDER",
        `Assignment due soon: ${a.title}`,
        `You have ${hoursLeft}h left to submit. Don't miss the deadline!`,
        `assignments:${a.id}`
      );
      created++;
    }
  }
  return created;
}
