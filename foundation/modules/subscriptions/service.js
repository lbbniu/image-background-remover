import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../../../db/client.js';
import { subscriptions } from '../../../db/schema.js';
import { ensureUserQuota } from '../credits/service.js';

export async function getActiveSubscription(d1, { userId, projectId }) {
  return getDb(d1)
    .select({ externalId: subscriptions.externalId })
    .from(subscriptions)
    .where(and(
      eq(subscriptions.userId, Number(userId)),
      eq(subscriptions.projectId, projectId),
      eq(subscriptions.status, 'active'),
    ))
    .get();
}

export async function activateUserSubscription(d1, {
  userId,
  projectId,
  planId,
  platform,
  externalId,
  monthlyCredits,
}) {
  await ensureUserQuota(d1, { userId, projectId });

  const now = new Date();
  const periodStart = now.toISOString();
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()).toISOString();

  await d1.batch([
    d1.prepare(`
      INSERT INTO subscriptions
        (user_id, project_id, plan_id, platform, external_id, status, current_period_start, current_period_end)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(platform, external_id) DO UPDATE SET
        user_id = excluded.user_id,
        project_id = excluded.project_id,
        plan_id = excluded.plan_id,
        status = 'active',
        current_period_start = excluded.current_period_start,
        current_period_end = excluded.current_period_end,
        updated_at = datetime('now')
    `).bind(Number(userId), projectId, planId, platform, externalId, periodStart, periodEnd),
    d1.prepare(`
      UPDATE user_quotas
      SET plan_id = ?,
          credits_monthly = ?,
          period_start = ?,
          period_end = ?,
          period_used = 0,
          updated_at = datetime('now')
      WHERE user_id = ? AND project_id = ?
    `).bind(planId, monthlyCredits, periodStart, periodEnd, Number(userId), projectId),
    d1.prepare(`
      INSERT OR IGNORE INTO credit_transactions
        (user_id, project_id, type, source, amount, platform, external_id, metadata)
      VALUES (?, ?, 'subscription', 'monthly', ?, ?, ?, ?)
    `).bind(
      Number(userId),
      projectId,
      monthlyCredits,
      platform,
      `subscription:${externalId}:${periodStart}`,
      JSON.stringify({ planId }),
    ),
  ]);
}

export async function cancelUserSubscription(d1, { userId, projectId }) {
  await getDb(d1)
    .update(subscriptions)
    .set({ status: 'cancelled', cancelAtPeriodEnd: 1, updatedAt: sql`datetime('now')` })
    .where(and(
      eq(subscriptions.userId, Number(userId)),
      eq(subscriptions.projectId, projectId),
      eq(subscriptions.status, 'active'),
    ))
    .run();
}

export async function getSubscriptionOwner(d1, { projectId, externalId }) {
  return getDb(d1)
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(and(eq(subscriptions.externalId, externalId), eq(subscriptions.projectId, projectId)))
    .get();
}

export async function updateSubscriptionStatus(d1, { projectId, externalId, status, clearSubscription = false }) {
  const db = getDb(d1);
  const subscription = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.externalId, externalId), eq(subscriptions.projectId, projectId)))
    .get();

  const statements = [
    d1.prepare(`
      UPDATE subscriptions
      SET status = ?,
          updated_at = datetime('now')
      WHERE external_id = ? AND project_id = ?
    `).bind(status, externalId, projectId),
  ];

  if (clearSubscription && subscription) {
    statements.push(d1.prepare(`
      UPDATE user_quotas
      SET credits_monthly = 0,
          period_used = 0,
          updated_at = datetime('now')
      WHERE user_id = ? AND project_id = ?
    `).bind(subscription.userId, projectId));
  }

  await d1.batch(statements);
}

export async function renewSubscriptionPeriod(d1, { projectId, externalId, periodEnd }) {
  const db = getDb(d1);
  const subscription = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.externalId, externalId), eq(subscriptions.projectId, projectId)))
    .get();

  if (!subscription) return;

  await d1.batch([
    d1.prepare(`
      UPDATE subscriptions
      SET current_period_end = ?,
          status = 'active',
          updated_at = datetime('now')
      WHERE external_id = ? AND project_id = ?
    `).bind(periodEnd, externalId, projectId),
    d1.prepare(`
      UPDATE user_quotas
      SET period_end = ?,
          period_used = 0,
          updated_at = datetime('now')
      WHERE user_id = ? AND project_id = ?
    `).bind(periodEnd, subscription.userId, projectId),
  ]);
}
