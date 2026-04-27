import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '../../../db/client.js';
import {
  creditTransactions,
  subscriptionPlans,
  subscriptions,
  usageLogs,
  userQuotas,
} from '../../../db/schema.js';

export function getCreditConsumeOrder(env) {
  const allowed = new Set(['monthly', 'purchased', 'gifted']);
  const configured = (env?.CREDIT_CONSUME_ORDER || 'monthly,purchased,gifted')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => allowed.has(item));

  return [...new Set(configured)].length ? [...new Set(configured)] : ['monthly', 'purchased', 'gifted'];
}

function monthPeriodFrom(date) {
  return {
    periodStart: new Date(date.getFullYear(), date.getMonth(), 1).toISOString(),
    periodEnd: new Date(date.getFullYear(), date.getMonth() + 1, 1).toISOString(),
  };
}

function nextPeriodFrom(periodEnd) {
  return {
    periodStart: periodEnd.toISOString(),
    periodEnd: new Date(periodEnd.getFullYear(), periodEnd.getMonth() + 1, periodEnd.getDate()).toISOString(),
  };
}

function toCreditBalance(quota, subscription) {
  const monthlyRemaining = Math.max(0, (quota.creditsMonthly || 0) - (quota.periodUsed || 0));
  const purchasedRemaining = quota.creditsPurchased || 0;
  const giftedRemaining = quota.creditsGifted || 0;
  const remaining = monthlyRemaining + purchasedRemaining + giftedRemaining;

  return {
    allowed: remaining > 0,
    remaining,
    monthlyRemaining,
    purchasedRemaining,
    giftedRemaining,
    plan: quota.planId,
    subscriptionStatus: subscription?.status || 'inactive',
    periodEnd: quota.periodEnd,
    totalUsed: quota.totalUsed || 0,
  };
}

function parseMetadata(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toPositiveInteger(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  const integer = Math.floor(parsed);
  return max ? Math.min(integer, max) : integer;
}

export async function ensureUserQuota(d1, { userId, projectId, giftedCredits = 3 }) {
  const db = getDb(d1);
  const period = monthPeriodFrom(new Date());

  await db
    .insert(userQuotas)
    .values({
      userId: Number(userId),
      projectId,
      planId: 'free',
      creditsGifted: giftedCredits,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      creditsMonthly: 0,
      periodUsed: 0,
    })
    .onConflictDoNothing({ target: [userQuotas.userId, userQuotas.projectId] })
    .run();

  if (giftedCredits > 0) {
    await db
      .insert(creditTransactions)
      .values({
        userId: Number(userId),
        projectId,
        type: 'gift',
        source: 'gifted',
        amount: giftedCredits,
        platform: 'system',
        externalId: `signup:${projectId}:${userId}`,
      })
      .onConflictDoNothing({
        target: [creditTransactions.projectId, creditTransactions.platform, creditTransactions.externalId],
      })
      .run();
  }
}

async function getCurrentSubscription(db, { userId, projectId }) {
  return db
    .select()
    .from(subscriptions)
    .where(and(
      eq(subscriptions.userId, Number(userId)),
      eq(subscriptions.projectId, projectId),
      sql`${subscriptions.status} IN ('active', 'cancelled', 'past_due')`,
    ))
    .get();
}

async function refreshSubscriptionPeriod(d1, quota, subscription) {
  const db = getDb(d1);
  const periodEnd = quota.periodEnd ? new Date(quota.periodEnd) : null;
  if (!periodEnd || periodEnd > new Date()) return quota;

  if (subscription?.status === 'active') {
    const plan = await db
      .select({ creditsMonthly: subscriptionPlans.creditsMonthly })
      .from(subscriptionPlans)
      .where(and(eq(subscriptionPlans.id, subscription.planId), eq(subscriptionPlans.projectId, quota.projectId)))
      .get();
    const next = nextPeriodFrom(periodEnd);

    await d1.batch([
      d1.prepare(`
        UPDATE user_quotas
        SET period_used = 0,
            credits_monthly = ?,
            period_start = ?,
            period_end = ?,
            updated_at = datetime('now')
        WHERE user_id = ? AND project_id = ?
      `).bind(plan?.creditsMonthly || 0, next.periodStart, next.periodEnd, quota.userId, quota.projectId),
      d1.prepare(`
        UPDATE subscriptions
        SET current_period_start = ?,
            current_period_end = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).bind(next.periodStart, next.periodEnd, subscription.id),
      d1.prepare(`
        INSERT OR IGNORE INTO credit_transactions
          (user_id, project_id, type, source, amount, platform, external_id, metadata)
        VALUES (?, ?, 'subscription', 'monthly', ?, ?, ?, ?)
      `).bind(
        quota.userId,
        quota.projectId,
        plan?.creditsMonthly || 0,
        subscription.platform,
        `subscription:${subscription.externalId}:${next.periodStart}`,
        JSON.stringify({ planId: subscription.planId }),
      ),
    ]);

    return {
      ...quota,
      periodUsed: 0,
      creditsMonthly: plan?.creditsMonthly || 0,
      periodStart: next.periodStart,
      periodEnd: next.periodEnd,
    };
  }

  if (subscription?.status === 'cancelled') {
    await d1.batch([
      d1.prepare(`
        UPDATE user_quotas
        SET credits_monthly = 0,
            period_used = 0,
            updated_at = datetime('now')
        WHERE user_id = ? AND project_id = ?
      `).bind(quota.userId, quota.projectId),
      d1.prepare(`
        UPDATE subscriptions
        SET status = 'expired',
            updated_at = datetime('now')
        WHERE id = ?
      `).bind(subscription.id),
    ]);

    return { ...quota, creditsMonthly: 0, periodUsed: 0 };
  }

  return quota;
}

export async function getUserCreditBalance(d1, { userId, projectId }) {
  const db = getDb(d1);
  await ensureUserQuota(d1, { userId, projectId });

  const quota = await db
    .select()
    .from(userQuotas)
    .where(and(eq(userQuotas.userId, Number(userId)), eq(userQuotas.projectId, projectId)))
    .get();
  const subscription = await getCurrentSubscription(db, { userId, projectId });
  const refreshed = await refreshSubscriptionPeriod(d1, quota, subscription);

  return toCreditBalance(refreshed, subscription);
}

export async function listUserCreditTransactions(d1, {
  userId,
  projectId,
  type,
  source,
  limit = 20,
  offset = 0,
}) {
  const db = getDb(d1);
  const pageLimit = toPositiveInteger(limit, 20, 100) || 20;
  const pageOffset = toPositiveInteger(offset, 0);
  const conditions = [
    eq(creditTransactions.userId, Number(userId)),
    eq(creditTransactions.projectId, projectId),
  ];

  if (type) conditions.push(eq(creditTransactions.type, type));
  if (source) conditions.push(eq(creditTransactions.source, source));

  const where = and(...conditions);
  const rows = await db
    .select()
    .from(creditTransactions)
    .where(where)
    .orderBy(desc(creditTransactions.createdAt), desc(creditTransactions.id))
    .limit(pageLimit)
    .offset(pageOffset);

  const totalRow = await db
    .select({ count: sql`COUNT(*)` })
    .from(creditTransactions)
    .where(where)
    .get();

  return {
    items: rows.map((row) => ({
      id: row.id,
      type: row.type,
      source: row.source,
      amount: row.amount,
      platform: row.platform,
      externalId: row.externalId,
      metadata: parseMetadata(row.metadata),
      createdAt: row.createdAt,
    })),
    pagination: {
      limit: pageLimit,
      offset: pageOffset,
      total: Number(totalRow?.count || 0),
      hasMore: pageOffset + rows.length < Number(totalRow?.count || 0),
    },
  };
}

function consumeStatement(d1, { userId, projectId, credits, source }) {
  if (source === 'monthly') {
    return d1.prepare(`
      UPDATE user_quotas
      SET period_used = period_used + ?,
          total_used = total_used + ?,
          updated_at = datetime('now')
      WHERE user_id = ? AND project_id = ?
        AND (credits_monthly - period_used) >= ?
    `).bind(credits, credits, Number(userId), projectId, credits);
  }

  if (source === 'purchased') {
    return d1.prepare(`
      UPDATE user_quotas
      SET credits_purchased = credits_purchased - ?,
          total_used = total_used + ?,
          updated_at = datetime('now')
      WHERE user_id = ? AND project_id = ?
        AND credits_purchased >= ?
    `).bind(credits, credits, Number(userId), projectId, credits);
  }

  if (source === 'gifted') {
    return d1.prepare(`
      UPDATE user_quotas
      SET credits_gifted = credits_gifted - ?,
          total_used = total_used + ?,
          updated_at = datetime('now')
      WHERE user_id = ? AND project_id = ?
        AND credits_gifted >= ?
    `).bind(credits, credits, Number(userId), projectId, credits);
  }

  return null;
}

export async function consumeCredit(d1, { userId, projectId, jobId, credits = 1, consumeOrder }) {
  const db = getDb(d1);
  await ensureUserQuota(d1, { userId, projectId });

  const existingUsage = await db
    .select()
    .from(usageLogs)
    .where(eq(usageLogs.jobId, jobId))
    .get();
  if (existingUsage?.status === 'success') {
    const updated = await getUserCreditBalance(d1, { userId, projectId });
    return { success: true, remaining: updated.remaining, source: existingUsage.source, idempotent: true };
  }
  if (existingUsage) {
    return { success: false, error: `job_${existingUsage.status || 'exists'}`, remaining: 0 };
  }

  const quota = await db
    .select()
    .from(userQuotas)
    .where(and(eq(userQuotas.userId, Number(userId)), eq(userQuotas.projectId, projectId)))
    .get();
  const subscription = await getCurrentSubscription(db, { userId, projectId });
  await refreshSubscriptionPeriod(d1, quota, subscription);

  let source;
  let result = { meta: { changes: 0 } };
  for (const candidate of consumeOrder || ['monthly', 'purchased', 'gifted']) {
    const statement = consumeStatement(d1, { userId, projectId, credits, source: candidate });
    if (!statement) continue;

    const [updateResult] = await d1.batch([
      statement,
      d1.prepare(`
        INSERT OR IGNORE INTO usage_logs
          (user_id, project_id, job_id, credits_used, source, status)
        SELECT ?, ?, ?, ?, ?, 'success'
        WHERE changes() > 0
      `).bind(Number(userId), projectId, jobId, credits, candidate),
      d1.prepare(`
        INSERT OR IGNORE INTO credit_transactions
          (user_id, project_id, type, source, amount, platform, external_id)
        SELECT ?, ?, 'consume', ?, ?, 'internal', ?
        WHERE EXISTS (
          SELECT 1 FROM usage_logs
          WHERE job_id = ?
            AND user_id = ?
            AND project_id = ?
            AND status = 'success'
            AND source = ?
        )
      `).bind(
        Number(userId),
        projectId,
        candidate,
        -credits,
        jobId,
        jobId,
        Number(userId),
        projectId,
        candidate,
      ),
    ]);

    result = updateResult;
    if (updateResult.meta?.changes) {
      source = candidate;
      break;
    }
  }

  if (!result.meta?.changes) {
    return { success: false, error: 'no_credits', remaining: 0 };
  }

  const updated = await getUserCreditBalance(d1, { userId, projectId });
  return { success: true, remaining: updated.remaining, source };
}

export async function updateUsageLog(d1, { jobId, status, metadata }) {
  const db = getDb(d1);
  await db
    .update(usageLogs)
    .set({
      ...(status ? { status } : {}),
      ...(metadata !== undefined ? { metadata: JSON.stringify(metadata) } : {}),
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(usageLogs.jobId, jobId))
    .run();
}

export async function refundCredit(d1, { userId, projectId, jobId, metadata }) {
  const db = getDb(d1);
  const usage = await db
    .select()
    .from(usageLogs)
    .where(eq(usageLogs.jobId, jobId))
    .get();

  if (!usage || usage.status === 'refunded') {
    return { refunded: false };
  }

  const credits = usage.creditsUsed || 1;
  let refundStatement = null;
  if (usage.source === 'monthly') {
    refundStatement = d1.prepare(`
      UPDATE user_quotas
      SET period_used = max(period_used - ?, 0),
          total_used = max(total_used - ?, 0),
          updated_at = datetime('now')
      WHERE user_id = ? AND project_id = ?
        AND EXISTS (
          SELECT 1 FROM usage_logs
          WHERE job_id = ? AND status != 'refunded'
        )
    `).bind(credits, credits, Number(userId), projectId, jobId);
  } else if (usage.source === 'purchased') {
    refundStatement = d1.prepare(`
      UPDATE user_quotas
      SET credits_purchased = credits_purchased + ?,
          total_used = max(total_used - ?, 0),
          updated_at = datetime('now')
      WHERE user_id = ? AND project_id = ?
        AND EXISTS (
          SELECT 1 FROM usage_logs
          WHERE job_id = ? AND status != 'refunded'
        )
    `).bind(credits, credits, Number(userId), projectId, jobId);
  } else if (usage.source === 'gifted') {
    refundStatement = d1.prepare(`
      UPDATE user_quotas
      SET credits_gifted = credits_gifted + ?,
          total_used = max(total_used - ?, 0),
          updated_at = datetime('now')
      WHERE user_id = ? AND project_id = ?
        AND EXISTS (
          SELECT 1 FROM usage_logs
          WHERE job_id = ? AND status != 'refunded'
        )
    `).bind(credits, credits, Number(userId), projectId, jobId);
  }

  if (!refundStatement) return { refunded: false };

  const [updateResult] = await d1.batch([
    refundStatement,
    d1.prepare(`
      UPDATE usage_logs
      SET status = 'refunded',
          metadata = ?,
          updated_at = datetime('now')
      WHERE job_id = ?
        AND status != 'refunded'
        AND changes() > 0
    `).bind(metadata ? JSON.stringify(metadata) : null, jobId),
    d1.prepare(`
      INSERT OR IGNORE INTO credit_transactions
        (user_id, project_id, type, source, amount, platform, external_id, metadata)
      SELECT ?, ?, 'refund', ?, ?, 'internal', ?, ?
      WHERE EXISTS (
        SELECT 1 FROM usage_logs
        WHERE job_id = ?
          AND user_id = ?
          AND project_id = ?
          AND status = 'refunded'
      )
    `).bind(
      Number(userId),
      projectId,
      usage.source,
      credits,
      `refund:${jobId}`,
      metadata ? JSON.stringify(metadata) : null,
      jobId,
      Number(userId),
      projectId,
    ),
  ]);

  return { refunded: Boolean(updateResult.meta?.changes) };
}
