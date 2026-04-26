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

    await db
      .update(userQuotas)
      .set({
        periodUsed: 0,
        creditsMonthly: plan?.creditsMonthly || 0,
        periodStart: next.periodStart,
        periodEnd: next.periodEnd,
        updatedAt: sql`datetime('now')`,
      })
      .where(and(eq(userQuotas.userId, quota.userId), eq(userQuotas.projectId, quota.projectId)))
      .run();

    await db
      .update(subscriptions)
      .set({
        currentPeriodStart: next.periodStart,
        currentPeriodEnd: next.periodEnd,
        updatedAt: sql`datetime('now')`,
      })
      .where(eq(subscriptions.id, subscription.id))
      .run();

    await db
      .insert(creditTransactions)
      .values({
        userId: quota.userId,
        projectId: quota.projectId,
        type: 'subscription',
        source: 'monthly',
        amount: plan?.creditsMonthly || 0,
        platform: subscription.platform,
        externalId: `subscription:${subscription.externalId}:${next.periodStart}`,
        metadata: JSON.stringify({ planId: subscription.planId }),
      })
      .onConflictDoNothing({
        target: [creditTransactions.projectId, creditTransactions.platform, creditTransactions.externalId],
      })
      .run();

    return {
      ...quota,
      periodUsed: 0,
      creditsMonthly: plan?.creditsMonthly || 0,
      periodStart: next.periodStart,
      periodEnd: next.periodEnd,
    };
  }

  if (subscription?.status === 'cancelled') {
    await db
      .update(userQuotas)
      .set({
        creditsMonthly: 0,
        periodUsed: 0,
        updatedAt: sql`datetime('now')`,
      })
      .where(and(eq(userQuotas.userId, quota.userId), eq(userQuotas.projectId, quota.projectId)))
      .run();

    await db
      .update(subscriptions)
      .set({ status: 'expired', updatedAt: sql`datetime('now')` })
      .where(eq(subscriptions.id, subscription.id))
      .run();

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

async function consumeFromSource(db, { userId, projectId, credits, source }) {
  if (source === 'monthly') {
    return db
      .update(userQuotas)
      .set({
        periodUsed: sql`${userQuotas.periodUsed} + ${credits}`,
        totalUsed: sql`${userQuotas.totalUsed} + ${credits}`,
        updatedAt: sql`datetime('now')`,
      })
      .where(and(
        eq(userQuotas.userId, Number(userId)),
        eq(userQuotas.projectId, projectId),
        sql`(${userQuotas.creditsMonthly} - ${userQuotas.periodUsed}) >= ${credits}`,
      ))
      .run();
  }

  if (source === 'purchased') {
    return db
      .update(userQuotas)
      .set({
        creditsPurchased: sql`${userQuotas.creditsPurchased} - ${credits}`,
        totalUsed: sql`${userQuotas.totalUsed} + ${credits}`,
        updatedAt: sql`datetime('now')`,
      })
      .where(and(
        eq(userQuotas.userId, Number(userId)),
        eq(userQuotas.projectId, projectId),
        sql`${userQuotas.creditsPurchased} >= ${credits}`,
      ))
      .run();
  }

  if (source === 'gifted') {
    return db
      .update(userQuotas)
      .set({
        creditsGifted: sql`${userQuotas.creditsGifted} - ${credits}`,
        totalUsed: sql`${userQuotas.totalUsed} + ${credits}`,
        updatedAt: sql`datetime('now')`,
      })
      .where(and(
        eq(userQuotas.userId, Number(userId)),
        eq(userQuotas.projectId, projectId),
        sql`${userQuotas.creditsGifted} >= ${credits}`,
      ))
      .run();
  }

  return { meta: { changes: 0 } };
}

export async function consumeCredit(d1, { userId, projectId, jobId, credits = 1, consumeOrder }) {
  const db = getDb(d1);
  await ensureUserQuota(d1, { userId, projectId });

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
    result = await consumeFromSource(db, { userId, projectId, credits, source: candidate });
    if (result.meta?.changes) {
      source = candidate;
      break;
    }
  }

  if (!result.meta?.changes) {
    return { success: false, error: 'no_credits', remaining: 0 };
  }

  await db
    .insert(usageLogs)
    .values({ userId: Number(userId), projectId, jobId, creditsUsed: credits, source, status: 'success' })
    .run();

  await db
    .insert(creditTransactions)
    .values({
      userId: Number(userId),
      projectId,
      type: 'consume',
      source,
      amount: -credits,
      platform: 'internal',
      externalId: jobId,
    })
    .onConflictDoNothing({
      target: [creditTransactions.projectId, creditTransactions.platform, creditTransactions.externalId],
    })
    .run();

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
  if (usage.source === 'monthly') {
    await db
      .update(userQuotas)
      .set({
        periodUsed: sql`max(${userQuotas.periodUsed} - ${credits}, 0)`,
        totalUsed: sql`max(${userQuotas.totalUsed} - ${credits}, 0)`,
        updatedAt: sql`datetime('now')`,
      })
      .where(and(eq(userQuotas.userId, Number(userId)), eq(userQuotas.projectId, projectId)))
      .run();
  } else if (usage.source === 'purchased') {
    await db
      .update(userQuotas)
      .set({
        creditsPurchased: sql`${userQuotas.creditsPurchased} + ${credits}`,
        totalUsed: sql`max(${userQuotas.totalUsed} - ${credits}, 0)`,
        updatedAt: sql`datetime('now')`,
      })
      .where(and(eq(userQuotas.userId, Number(userId)), eq(userQuotas.projectId, projectId)))
      .run();
  } else if (usage.source === 'gifted') {
    await db
      .update(userQuotas)
      .set({
        creditsGifted: sql`${userQuotas.creditsGifted} + ${credits}`,
        totalUsed: sql`max(${userQuotas.totalUsed} - ${credits}, 0)`,
        updatedAt: sql`datetime('now')`,
      })
      .where(and(eq(userQuotas.userId, Number(userId)), eq(userQuotas.projectId, projectId)))
      .run();
  }

  await updateUsageLog(d1, { jobId, status: 'refunded', metadata });
  await db
    .insert(creditTransactions)
    .values({
      userId: Number(userId),
      projectId,
      type: 'refund',
      source: usage.source,
      amount: credits,
      platform: 'internal',
      externalId: `refund:${jobId}`,
      metadata: metadata ? JSON.stringify(metadata) : null,
    })
    .onConflictDoNothing({
      target: [creditTransactions.projectId, creditTransactions.platform, creditTransactions.externalId],
    })
    .run();

  return { refunded: true };
}
