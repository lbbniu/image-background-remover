import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../../../db/client.js';
import { subscriptions } from '../../../db/schema.js';
import {
  CREDIT_SOURCES,
  CREDIT_TX_TYPES,
  SUBSCRIPTION_STATUS,
} from '../core/constants.js';
import { addMonthsUtc, utcDate } from '../core/time.js';
import { ensureUserQuota } from '../credits/service.js';

export async function getActiveSubscription(d1, { userId, projectId }) {
  return getDb(d1)
    .select({
      externalId: subscriptions.externalId,
      planId: subscriptions.planId,
      platform: subscriptions.platform,
      status: subscriptions.status,
    })
    .from(subscriptions)
    .where(and(
      eq(subscriptions.userId, Number(userId)),
      eq(subscriptions.projectId, projectId),
      eq(subscriptions.status, SUBSCRIPTION_STATUS.active),
    ))
    .get();
}

function defaultPeriodWindow(now = new Date()) {
  const periodStart = now.toISOString();
  const periodEnd = addMonthsUtc(now, 1).toISOString();
  return { periodStart, periodEnd };
}

export async function activateUserSubscription(d1, {
  userId,
  projectId,
  planId,
  platform,
  externalId,
  monthlyCredits,
  periodStart: periodStartIn,
  periodEnd: periodEndIn,
}) {
  await ensureUserQuota(d1, { userId, projectId, giftedCredits: 0 });

  const window = defaultPeriodWindow();
  const periodStart = periodStartIn || window.periodStart;
  const periodEnd = periodEndIn || window.periodEnd;
  const safeMonthly = Math.max(0, Math.floor(Number(monthlyCredits) || 0));

  await d1.batch([
    // 同一 (user_id, project_id) 下若存在另一条 active 订阅，先标记为 expired，
    // 否则下面 INSERT 新 active 行会触发 uq_subscriptions_active_per_user 部分唯一索引冲突。
    d1.prepare(`
      UPDATE subscriptions
      SET status = ?, updated_at = datetime('now')
      WHERE user_id = ? AND project_id = ?
        AND status = 'active'
        AND NOT (platform = ? AND external_id = ?)
    `).bind(SUBSCRIPTION_STATUS.expired, Number(userId), projectId, platform, externalId),
    d1.prepare(`
      INSERT INTO subscriptions
        (user_id, project_id, plan_id, platform, external_id, status, current_period_start, current_period_end)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(platform, external_id) DO UPDATE SET
        user_id = excluded.user_id,
        project_id = excluded.project_id,
        plan_id = excluded.plan_id,
        status = 'active',
        cancel_at_period_end = 0,
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
    `).bind(planId, safeMonthly, periodStart, periodEnd, Number(userId), projectId),
    d1.prepare(`
      INSERT OR IGNORE INTO credit_transactions
        (user_id, project_id, type, source, amount, platform, external_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      Number(userId),
      projectId,
      CREDIT_TX_TYPES.subscription,
      CREDIT_SOURCES.monthly,
      safeMonthly,
      platform,
      `subscription:${externalId}:${periodStart}`,
      JSON.stringify({ planId }),
    ),
  ]);
}

export async function cancelUserSubscription(d1, {
  userId,
  projectId,
  externalId,
  immediate = false,
}) {
  // 仅本地标记，不会调用上游平台。
  // externalId 可选：若提供则只取消该条订阅，未提供时取消该 user/project 下所有 active。
  // 默认走 cancel_at_period_end 流程：保持 status='active' 直到 periodEnd 到期由 refresh 切到 expired；
  // 传 immediate=true 时立即置为 cancelled，下一次 refresh 会清掉月度额度。
  const conditions = [
    eq(subscriptions.userId, Number(userId)),
    eq(subscriptions.projectId, projectId),
    eq(subscriptions.status, SUBSCRIPTION_STATUS.active),
  ];
  if (externalId) {
    conditions.push(eq(subscriptions.externalId, externalId));
  }

  await getDb(d1)
    .update(subscriptions)
    .set({
      ...(immediate ? { status: SUBSCRIPTION_STATUS.cancelled } : {}),
      cancelAtPeriodEnd: 1,
      updatedAt: sql`datetime('now')`,
    })
    .where(and(...conditions))
    .run();
}

export async function getSubscriptionOwner(d1, { projectId, externalId }) {
  return getDb(d1)
    .select({ userId: subscriptions.userId, planId: subscriptions.planId })
    .from(subscriptions)
    .where(and(eq(subscriptions.externalId, externalId), eq(subscriptions.projectId, projectId)))
    .get();
}

export async function updateSubscriptionStatus(d1, {
  projectId,
  externalId,
  status,
  clearSubscription = false,
}) {
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

export async function renewSubscriptionPeriod(d1, {
  projectId,
  externalId,
  periodEnd,
  periodStart,
  monthlyCredits,
  planId,
}) {
  const db = getDb(d1);
  const subscription = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.externalId, externalId), eq(subscriptions.projectId, projectId)))
    .get();
  if (!subscription) return { renewed: false };

  // 续期窗口：上游传 periodEnd（next_billing_time）；periodStart 缺省取当前 current_period_end
  const start = periodStart || subscription.currentPeriodEnd || utcDate().toISOString();
  const end = periodEnd || addMonthsUtc(utcDate(start), 1).toISOString();
  const safeMonthly = monthlyCredits != null
    ? Math.max(0, Math.floor(Number(monthlyCredits) || 0))
    : null;
  const targetPlanId = planId || subscription.planId;

  const statements = [
    d1.prepare(`
      UPDATE subscriptions
      SET current_period_start = ?,
          current_period_end = ?,
          status = 'active',
          plan_id = ?,
          updated_at = datetime('now')
      WHERE external_id = ? AND project_id = ?
    `).bind(start, end, targetPlanId, externalId, projectId),
  ];

  if (safeMonthly != null) {
    statements.push(d1.prepare(`
      UPDATE user_quotas
      SET plan_id = ?,
          credits_monthly = ?,
          period_start = ?,
          period_end = ?,
          period_used = 0,
          updated_at = datetime('now')
      WHERE user_id = ? AND project_id = ?
    `).bind(targetPlanId, safeMonthly, start, end, subscription.userId, projectId));
  } else {
    statements.push(d1.prepare(`
      UPDATE user_quotas
      SET plan_id = ?,
          period_start = ?,
          period_end = ?,
          period_used = 0,
          updated_at = datetime('now')
      WHERE user_id = ? AND project_id = ?
    `).bind(targetPlanId, start, end, subscription.userId, projectId));
  }

  if (safeMonthly != null && safeMonthly > 0) {
    statements.push(d1.prepare(`
      INSERT OR IGNORE INTO credit_transactions
        (user_id, project_id, type, source, amount, platform, external_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      subscription.userId,
      projectId,
      CREDIT_TX_TYPES.subscription,
      CREDIT_SOURCES.monthly,
      safeMonthly,
      subscription.platform,
      `subscription:${externalId}:${start}`,
      JSON.stringify({ planId: targetPlanId }),
    ));
  }

  await d1.batch(statements);
  return { renewed: true };
}
