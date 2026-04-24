import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { creditPurchases, subscriptionPlans, usageLogs, userQuotas } from '../../db/schema.js';

export function getProjectId(env) {
  return env?.PROJECT_ID || 'clearcut';
}

export function getCreditPackages() {
  return {
    '50': { credits: 50, price: '4.99', label: '50 Credits' },
    '200': { credits: 200, price: '14.99', label: '200 Credits' },
    '500': { credits: 500, price: '29.99', label: '500 Credits' },
  };
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

function toCreditBalance(quota) {
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
    subscriptionStatus: quota.subscriptionStatus,
    periodEnd: quota.periodEnd,
    totalUsed: quota.totalUsed || 0,
  };
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
}

async function refreshSubscriptionPeriod(d1, quota) {
  const db = getDb(d1);
  const periodEnd = quota.periodEnd ? new Date(quota.periodEnd) : null;
  if (!periodEnd || periodEnd > new Date()) return quota;

  if (quota.subscriptionStatus === 'active') {
    const plan = await db
      .select({ creditsMonthly: subscriptionPlans.creditsMonthly })
      .from(subscriptionPlans)
      .where(and(eq(subscriptionPlans.id, quota.planId), eq(subscriptionPlans.projectId, quota.projectId)))
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

    return {
      ...quota,
      periodUsed: 0,
      creditsMonthly: plan?.creditsMonthly || 0,
      periodStart: next.periodStart,
      periodEnd: next.periodEnd,
    };
  }

  if (quota.subscriptionStatus === 'cancelled') {
    await db
      .update(userQuotas)
      .set({
        subscriptionStatus: 'expired',
        creditsMonthly: 0,
        periodUsed: 0,
        updatedAt: sql`datetime('now')`,
      })
      .where(and(eq(userQuotas.userId, quota.userId), eq(userQuotas.projectId, quota.projectId)))
      .run();

    return { ...quota, subscriptionStatus: 'expired', creditsMonthly: 0, periodUsed: 0 };
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
  const refreshed = await refreshSubscriptionPeriod(d1, quota);

  return toCreditBalance(refreshed);
}

export async function consumeCredit(d1, { userId, projectId, jobId, credits = 1 }) {
  const db = getDb(d1);
  await ensureUserQuota(d1, { userId, projectId });

  const quota = await db
    .select()
    .from(userQuotas)
    .where(and(eq(userQuotas.userId, Number(userId)), eq(userQuotas.projectId, projectId)))
    .get();
  await refreshSubscriptionPeriod(d1, quota);

  let source = 'monthly';
  let result = await db
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

  if (!result.meta?.changes) {
    source = 'purchased';
    result = await db
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

  if (!result.meta?.changes) {
    source = 'gifted';
    result = await db
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

  if (!result.meta?.changes) {
    return { success: false, error: 'no_credits', remaining: 0 };
  }

  await db
    .insert(usageLogs)
    .values({ userId: Number(userId), projectId, jobId, creditsUsed: credits, source, status: 'success' })
    .run();

  const updated = await getUserCreditBalance(d1, { userId, projectId });
  return { success: true, remaining: updated.remaining, source };
}

export async function updateUsageLog(d1, { jobId, status, processingTimeMs }) {
  const db = getDb(d1);
  await db
    .update(usageLogs)
    .set({
      ...(status ? { status } : {}),
      ...(processingTimeMs !== undefined ? { processingTimeMs } : {}),
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(usageLogs.jobId, jobId))
    .run();
}

export async function addPurchasedCredits(d1, { userId, projectId, packageName, credits, pricePaidCents, paymentProvider, paymentIntentId }) {
  const db = getDb(d1);
  await ensureUserQuota(d1, { userId, projectId });

  const existing = await db
    .select({ id: creditPurchases.id })
    .from(creditPurchases)
    .where(and(eq(creditPurchases.paymentProvider, paymentProvider), eq(creditPurchases.paymentIntentId, paymentIntentId)))
    .get();
  if (existing) return { applied: false, reason: 'duplicate_payment' };

  await d1.batch([
    d1.prepare(`
      UPDATE user_quotas
      SET credits_purchased = credits_purchased + ?,
          total_purchased = total_purchased + ?,
          updated_at = datetime('now')
      WHERE user_id = ? AND project_id = ?
    `).bind(credits, credits, Number(userId), projectId),
    d1.prepare(`
      INSERT INTO credit_purchases
        (user_id, package_name, credits_amount, price_paid_cents, payment_provider, payment_intent_id, status, project_id)
      VALUES (?, ?, ?, ?, ?, ?, 'completed', ?)
    `).bind(Number(userId), packageName, credits, pricePaidCents, paymentProvider, paymentIntentId, projectId),
  ]);

  return { applied: true };
}

export async function getPlan(d1, { planId, projectId }) {
  return getDb(d1)
    .select()
    .from(subscriptionPlans)
    .where(and(eq(subscriptionPlans.id, planId), eq(subscriptionPlans.projectId, projectId)))
    .get();
}

export async function getActiveSubscription(d1, { userId, projectId }) {
  return getDb(d1)
    .select({ subscriptionExternalId: userQuotas.subscriptionExternalId })
    .from(userQuotas)
    .where(and(
      eq(userQuotas.userId, Number(userId)),
      eq(userQuotas.projectId, projectId),
      eq(userQuotas.subscriptionStatus, 'active'),
    ))
    .get();
}

export async function activateUserSubscription(d1, { userId, projectId, planId, subscriptionProvider, subscriptionExternalId, monthlyCredits }) {
  const db = getDb(d1);
  await ensureUserQuota(d1, { userId, projectId });

  const now = new Date();
  const periodStart = now.toISOString();
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()).toISOString();

  await db
    .update(userQuotas)
    .set({
      planId,
      subscriptionStatus: 'active',
      subscriptionProvider,
      subscriptionExternalId,
      creditsMonthly: monthlyCredits,
      periodStart,
      periodEnd,
      periodUsed: 0,
      updatedAt: sql`datetime('now')`,
    })
    .where(and(eq(userQuotas.userId, Number(userId)), eq(userQuotas.projectId, projectId)))
    .run();
}

export async function cancelUserSubscription(d1, { userId, projectId }) {
  await getDb(d1)
    .update(userQuotas)
    .set({ subscriptionStatus: 'cancelled', updatedAt: sql`datetime('now')` })
    .where(and(
      eq(userQuotas.userId, Number(userId)),
      eq(userQuotas.projectId, projectId),
      eq(userQuotas.subscriptionStatus, 'active'),
    ))
    .run();
}

export async function getSubscriptionOwner(d1, { projectId, subscriptionExternalId }) {
  return getDb(d1)
    .select({ userId: userQuotas.userId })
    .from(userQuotas)
    .where(and(eq(userQuotas.subscriptionExternalId, subscriptionExternalId), eq(userQuotas.projectId, projectId)))
    .get();
}

export async function updateSubscriptionStatus(d1, { projectId, subscriptionExternalId, status, clearSubscription = false }) {
  await getDb(d1)
    .update(userQuotas)
    .set({
      subscriptionStatus: status,
      ...(clearSubscription ? { creditsMonthly: 0, subscriptionExternalId: null, subscriptionProvider: null } : {}),
      updatedAt: sql`datetime('now')`,
    })
    .where(and(eq(userQuotas.subscriptionExternalId, subscriptionExternalId), eq(userQuotas.projectId, projectId)))
    .run();
}

export async function renewSubscriptionPeriod(d1, { projectId, subscriptionExternalId, periodEnd }) {
  await getDb(d1)
    .update(userQuotas)
    .set({
      periodEnd,
      periodUsed: 0,
      subscriptionStatus: 'active',
      updatedAt: sql`datetime('now')`,
    })
    .where(and(eq(userQuotas.subscriptionExternalId, subscriptionExternalId), eq(userQuotas.projectId, projectId)))
    .run();
}
