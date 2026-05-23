import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '../../../db/client.js';
import {
  creditTransactions,
  subscriptionPlans,
  subscriptions,
  usageLogs,
  userQuotas,
} from '../../../db/schema.js';
import {
  CREDIT_SOURCES,
  CREDIT_SOURCE_LIST,
  CREDIT_TX_TYPES,
  PAYMENT_PLATFORMS,
  SUBSCRIPTION_STATUS,
  USAGE_LOG_STATUS,
} from '../core/constants.js';
import {
  addMonthsUtc,
  isExpiredUtc,
  monthPeriodFromUtc,
  utcDate,
} from '../core/time.js';

const VALID_SOURCES = new Set(CREDIT_SOURCE_LIST);

export function getCreditConsumeOrder(env) {
  const raw = env?.CREDIT_CONSUME_ORDER;
  const fallback = [...CREDIT_SOURCE_LIST];
  if (!raw) return fallback;

  const seen = new Set();
  const ordered = [];
  for (const item of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (!VALID_SOURCES.has(item)) {
      console.warn(`[credits] CREDIT_CONSUME_ORDER ignores unknown source: ${item}`);
      continue;
    }
    if (seen.has(item)) continue;
    seen.add(item);
    ordered.push(item);
  }
  return ordered.length ? ordered : fallback;
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
    subscriptionStatus: subscription?.status || SUBSCRIPTION_STATUS.expired,
    hasSubscription: Boolean(subscription),
    periodStart: quota.periodStart,
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
  const period = monthPeriodFromUtc();
  const safeGifted = Math.max(0, Math.floor(Number(giftedCredits) || 0));

  await db
    .insert(userQuotas)
    .values({
      userId: Number(userId),
      projectId,
      planId: 'free',
      creditsGifted: safeGifted,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      creditsMonthly: 0,
      periodUsed: 0,
    })
    .onConflictDoNothing({ target: [userQuotas.userId, userQuotas.projectId] })
    .run();

  if (safeGifted > 0) {
    await db
      .insert(creditTransactions)
      .values({
        userId: Number(userId),
        projectId,
        type: CREDIT_TX_TYPES.gift,
        source: CREDIT_SOURCES.gifted,
        amount: safeGifted,
        platform: PAYMENT_PLATFORMS.system,
        externalId: `signup:${projectId}:${userId}`,
      })
      .onConflictDoNothing({
        target: [creditTransactions.projectId, creditTransactions.platform, creditTransactions.externalId],
      })
      .run();
  }
}

async function getCurrentSubscription(db, { userId, projectId }) {
  // 同一 user/project 可能存在多条历史 sub（一条 active + 旧的 cancelled/past_due）。
  // 必须显式按 active 优先 + updated_at 倒序取，不能依赖 .get() 的隐式顺序。
  return db
    .select()
    .from(subscriptions)
    .where(and(
      eq(subscriptions.userId, Number(userId)),
      eq(subscriptions.projectId, projectId),
      sql`${subscriptions.status} IN ('active','cancelled','past_due','paused')`,
    ))
    .orderBy(
      sql`CASE ${subscriptions.status}
            WHEN 'active' THEN 0
            WHEN 'past_due' THEN 1
            WHEN 'paused' THEN 2
            WHEN 'cancelled' THEN 3
            ELSE 4 END`,
      desc(subscriptions.updatedAt),
      desc(subscriptions.id),
    )
    .get();
}

async function getPlanMonthlyCredits(db, { planId, projectId }) {
  if (!planId) return 0;
  const plan = await db
    .select({ creditsMonthly: subscriptionPlans.creditsMonthly })
    .from(subscriptionPlans)
    .where(and(eq(subscriptionPlans.id, planId), eq(subscriptionPlans.projectId, projectId)))
    .get();
  return plan?.creditsMonthly || 0;
}

async function refreshSubscriptionPeriod(d1, quota, subscription) {
  const db = getDb(d1);
  if (!quota?.periodEnd) return quota;
  if (!isExpiredUtc(quota.periodEnd)) return quota;

  const projectId = quota.projectId;
  const status = subscription?.status;
  // 用户已请求"周期末取消"：不再自动续期，按 cancelled 路径走（下一次 refresh 会变 expired）。
  const cancelAtPeriodEnd = subscription?.cancelAtPeriodEnd === 1;

  // active：自动续期 → 把 periodEnd 推进到当前时刻所在周期，每个跳过的周期单独写一条流水，
  // 确保即使 webhook 长时间故障，也能在下次访问时一次性补齐。
  if (status === SUBSCRIPTION_STATUS.active && !cancelAtPeriodEnd) {
    const monthlyCredits = await getPlanMonthlyCredits(db, {
      planId: subscription.planId,
      projectId,
    });

    const periods = [];
    let cursorStart = utcDate(quota.periodEnd);
    let cursorEnd = addMonthsUtc(cursorStart, 1);
    // 最多补 60 期防止脏数据导致死循环；正常运行下 1 次即够。
    for (let i = 0; i < 60 && isExpiredUtc(cursorStart); i += 1) {
      periods.push({
        start: cursorStart.toISOString(),
        end: cursorEnd.toISOString(),
      });
      if (!isExpiredUtc(cursorEnd)) break;
      cursorStart = cursorEnd;
      cursorEnd = addMonthsUtc(cursorStart, 1);
    }
    if (!periods.length) return quota;

    const finalPeriod = periods[periods.length - 1];
    const statements = [
      d1.prepare(`
        UPDATE user_quotas
        SET period_used = 0,
            credits_monthly = ?,
            period_start = ?,
            period_end = ?,
            updated_at = datetime('now')
        WHERE user_id = ? AND project_id = ?
          AND period_end = ?
      `).bind(monthlyCredits, finalPeriod.start, finalPeriod.end, quota.userId, projectId, quota.periodEnd),
      d1.prepare(`
        UPDATE subscriptions
        SET current_period_start = ?,
            current_period_end = ?,
            updated_at = datetime('now')
        WHERE id = ?
          AND current_period_end = ?
      `).bind(finalPeriod.start, finalPeriod.end, subscription.id, quota.periodEnd),
    ];
    for (const { start } of periods) {
      statements.push(d1.prepare(`
        INSERT OR IGNORE INTO credit_transactions
          (user_id, project_id, type, source, amount, platform, external_id, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        quota.userId,
        projectId,
        CREDIT_TX_TYPES.subscription,
        CREDIT_SOURCES.monthly,
        monthlyCredits,
        subscription.platform,
        `subscription:${subscription.externalId}:${start}`,
        JSON.stringify({
          planId: subscription.planId,
          ...(periods.length > 1 ? { catchUp: true, totalPeriods: periods.length } : {}),
        }),
      ));
    }

    const [updateResult] = await d1.batch(statements);
    // 并发场景：另一并发调用已经把 period_end 推进，本次没改任何行，直接返回原 quota
    if (!updateResult.meta?.changes) return quota;

    return {
      ...quota,
      periodUsed: 0,
      creditsMonthly: monthlyCredits,
      periodStart: finalPeriod.start,
      periodEnd: finalPeriod.end,
    };
  }

  // cancelled 或 active+cancelAtPeriodEnd：到期不再续费，标记为 expired 并清空月度额度
  if (status === SUBSCRIPTION_STATUS.cancelled
      || (status === SUBSCRIPTION_STATUS.active && cancelAtPeriodEnd)) {
    await d1.batch([
      d1.prepare(`
        UPDATE user_quotas
        SET credits_monthly = 0,
            period_used = 0,
            updated_at = datetime('now')
        WHERE user_id = ? AND project_id = ?
          AND period_end = ?
      `).bind(quota.userId, projectId, quota.periodEnd),
      d1.prepare(`
        UPDATE subscriptions
        SET status = ?, updated_at = datetime('now') WHERE id = ?
      `).bind(SUBSCRIPTION_STATUS.expired, subscription.id),
    ]);
    return { ...quota, creditsMonthly: 0, periodUsed: 0 };
  }

  // past_due / paused：到期视为冻结，月度额度归零，等待外部 webhook 决定续费/取消
  if (status === SUBSCRIPTION_STATUS.pastDue || status === SUBSCRIPTION_STATUS.paused) {
    await d1.prepare(`
      UPDATE user_quotas
      SET credits_monthly = 0,
          period_used = 0,
          updated_at = datetime('now')
      WHERE user_id = ? AND project_id = ?
        AND period_end = ?
    `).bind(quota.userId, projectId, quota.periodEnd).run();
    return { ...quota, creditsMonthly: 0, periodUsed: 0 };
  }

  // 没有有效订阅（free 或 expired）：不做任何变更
  return quota;
}

export async function getUserCreditBalance(d1, { userId, projectId }) {
  const db = getDb(d1);
  await ensureUserQuota(d1, { userId, projectId, giftedCredits: 0 });

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

function consumeStatement(d1, { userId, projectId, jobId, credits, source }) {
  // 同一个 batch 内：先扣额度，再把"持有的 pending 行"翻成 success；
  // WHERE 子句要求当前 usage_logs 仍是 pending，避免被并发的 refund/失败抢占。
  if (source === CREDIT_SOURCES.monthly) {
    return d1.prepare(`
      UPDATE user_quotas
      SET period_used = period_used + ?,
          total_used = total_used + ?,
          updated_at = datetime('now')
      WHERE user_id = ? AND project_id = ?
        AND (credits_monthly - period_used) >= ?
        AND EXISTS (
          SELECT 1 FROM usage_logs
          WHERE job_id = ? AND project_id = ? AND status = 'pending'
        )
    `).bind(credits, credits, Number(userId), projectId, credits, jobId, projectId);
  }

  if (source === CREDIT_SOURCES.purchased) {
    return d1.prepare(`
      UPDATE user_quotas
      SET credits_purchased = credits_purchased - ?,
          total_used = total_used + ?,
          updated_at = datetime('now')
      WHERE user_id = ? AND project_id = ?
        AND credits_purchased >= ?
        AND EXISTS (
          SELECT 1 FROM usage_logs
          WHERE job_id = ? AND project_id = ? AND status = 'pending'
        )
    `).bind(credits, credits, Number(userId), projectId, credits, jobId, projectId);
  }

  if (source === CREDIT_SOURCES.gifted) {
    return d1.prepare(`
      UPDATE user_quotas
      SET credits_gifted = credits_gifted - ?,
          total_used = total_used + ?,
          updated_at = datetime('now')
      WHERE user_id = ? AND project_id = ?
        AND credits_gifted >= ?
        AND EXISTS (
          SELECT 1 FROM usage_logs
          WHERE job_id = ? AND project_id = ? AND status = 'pending'
        )
    `).bind(credits, credits, Number(userId), projectId, credits, jobId, projectId);
  }

  return null;
}

export async function consumeCredit(d1, {
  userId,
  projectId,
  jobId,
  credits = 1,
  consumeOrder = CREDIT_SOURCE_LIST,
}) {
  if (!jobId) throw new Error('consumeCredit: jobId is required');
  const safeCredits = Math.max(1, Math.floor(Number(credits) || 1));

  const db = getDb(d1);
  await ensureUserQuota(d1, { userId, projectId, giftedCredits: 0 });

  // 1) 先抢占 jobId：INSERT OR IGNORE pending 行
  const claim = await d1.prepare(`
    INSERT OR IGNORE INTO usage_logs
      (user_id, project_id, job_id, credits_used, source, status)
    VALUES (?, ?, ?, ?, NULL, 'pending')
  `).bind(Number(userId), projectId, jobId, safeCredits).run();

  if (!claim.meta?.changes) {
    // 同 jobId 已存在：根据状态返回幂等结果
    const existing = await db
      .select()
      .from(usageLogs)
      .where(eq(usageLogs.jobId, jobId))
      .get();
    if (existing?.status === USAGE_LOG_STATUS.success) {
      const updated = await getUserCreditBalance(d1, { userId, projectId });
      return { success: true, remaining: updated.remaining, source: existing.source, idempotent: true };
    }
    if (existing?.status === USAGE_LOG_STATUS.refunded) {
      return { success: false, error: 'job_refunded', remaining: 0 };
    }
    return { success: false, error: `job_${existing?.status || 'in_progress'}`, remaining: 0 };
  }

  // 2) 触发周期续期/冻结（不影响并发抢占）
  const quota = await db
    .select()
    .from(userQuotas)
    .where(and(eq(userQuotas.userId, Number(userId)), eq(userQuotas.projectId, projectId)))
    .get();
  const subscription = await getCurrentSubscription(db, { userId, projectId });
  await refreshSubscriptionPeriod(d1, quota, subscription);

  // 3) 按顺序尝试每个来源；成功的一笔会把 pending 翻成 success
  let appliedSource = null;
  for (const candidate of consumeOrder) {
    const update = consumeStatement(d1, {
      userId,
      projectId,
      jobId,
      credits: safeCredits,
      source: candidate,
    });
    if (!update) continue;

    const [updateResult] = await d1.batch([
      update,
      d1.prepare(`
        UPDATE usage_logs
        SET source = ?, status = 'success', updated_at = datetime('now')
        WHERE job_id = ? AND project_id = ? AND status = 'pending'
          AND changes() > 0
      `).bind(candidate, jobId, projectId),
      d1.prepare(`
        INSERT OR IGNORE INTO credit_transactions
          (user_id, project_id, type, source, amount, platform, external_id)
        SELECT ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM usage_logs
          WHERE job_id = ? AND project_id = ? AND status = 'success' AND source = ?
        )
      `).bind(
        Number(userId),
        projectId,
        CREDIT_TX_TYPES.consume,
        candidate,
        -safeCredits,
        PAYMENT_PLATFORMS.internal,
        jobId,
        jobId,
        projectId,
        candidate,
      ),
    ]);

    if (updateResult.meta?.changes) {
      appliedSource = candidate;
      break;
    }
  }

  if (!appliedSource) {
    // 没有可用额度：把抢占行标记为 failed，避免阻塞后续相同 jobId 的查询
    await d1.prepare(`
      UPDATE usage_logs
      SET status = 'failed', updated_at = datetime('now')
      WHERE job_id = ? AND project_id = ? AND status = 'pending'
    `).bind(jobId, projectId).run();
    return { success: false, error: 'no_credits', remaining: 0 };
  }

  const updated = await getUserCreditBalance(d1, { userId, projectId });
  return { success: true, remaining: updated.remaining, source: appliedSource };
}

// 仅用于在 consumeCredit 之后给 usage_log 追加业务 metadata。
// 不允许直接改 status：status 由 consumeCredit/refundCredit 通过原子状态转换管理。
// userId 必填，用于校验调用方与 usage_log 行所属用户一致，防止越权。
export async function updateUsageLog(d1, { userId, projectId, jobId, metadata }) {
  if (!jobId) throw new Error('updateUsageLog: jobId is required');
  if (userId == null) throw new Error('updateUsageLog: userId is required');

  const db = getDb(d1);
  const conditions = [eq(usageLogs.jobId, jobId), eq(usageLogs.userId, Number(userId))];
  if (projectId != null) conditions.push(eq(usageLogs.projectId, projectId));

  await db
    .update(usageLogs)
    .set({
      ...(metadata !== undefined ? { metadata: JSON.stringify(metadata) } : {}),
      updatedAt: sql`datetime('now')`,
    })
    .where(and(...conditions))
    .run();
}

function refundColumnUpdate(source) {
  if (source === CREDIT_SOURCES.monthly) {
    return 'period_used = max(period_used - ?, 0)';
  }
  if (source === CREDIT_SOURCES.purchased) {
    return 'credits_purchased = credits_purchased + ?';
  }
  if (source === CREDIT_SOURCES.gifted) {
    return 'credits_gifted = credits_gifted + ?';
  }
  return null;
}

export async function refundCredit(d1, { userId, projectId, jobId, metadata }) {
  if (!jobId) throw new Error('refundCredit: jobId is required');
  const db = getDb(d1);

  const usage = await db
    .select()
    .from(usageLogs)
    .where(eq(usageLogs.jobId, jobId))
    .get();
  if (!usage || usage.status !== USAGE_LOG_STATUS.success) {
    return { refunded: false };
  }

  // 校验调用方 userId 必须匹配 usage_log 上的 userId（防越权扣别人的额度）。
  // userId 缺省时（内部任务）信任 usage_log 自己的值。
  if (userId != null && Number(userId) !== usage.userId) {
    return { refunded: false, error: 'user_mismatch' };
  }
  if (projectId != null && projectId !== usage.projectId) {
    return { refunded: false, error: 'project_mismatch' };
  }

  const ownerUserId = usage.userId;
  const ownerProjectId = usage.projectId;
  const credits = usage.creditsUsed || 1;
  const source = usage.source;
  const columnUpdate = refundColumnUpdate(source);
  if (!columnUpdate) return { refunded: false };

  // 关键：先把 usage_logs.status 从 success 抢占翻到 refunded（条件 status='success'）。
  // 该 UPDATE 只能成功一次，因此后续的额度回补/流水也只会执行一次。
  const claim = await d1.prepare(`
    UPDATE usage_logs
    SET status = 'refunded',
        metadata = COALESCE(?, metadata),
        updated_at = datetime('now')
    WHERE job_id = ?
      AND project_id = ?
      AND status = 'success'
  `).bind(metadata ? JSON.stringify(metadata) : null, jobId, ownerProjectId).run();

  if (!claim.meta?.changes) return { refunded: false };

  await d1.batch([
    d1.prepare(`
      UPDATE user_quotas
      SET ${columnUpdate},
          total_used = max(total_used - ?, 0),
          updated_at = datetime('now')
      WHERE user_id = ? AND project_id = ?
    `).bind(credits, credits, ownerUserId, ownerProjectId),
    d1.prepare(`
      INSERT OR IGNORE INTO credit_transactions
        (user_id, project_id, type, source, amount, platform, external_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      ownerUserId,
      ownerProjectId,
      CREDIT_TX_TYPES.refund,
      source,
      credits,
      PAYMENT_PLATFORMS.internal,
      `refund:${jobId}`,
      metadata ? JSON.stringify(metadata) : null,
    ),
  ]);

  return { refunded: true };
}
