import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import {
  creditPurchases,
  creditTransactions,
  paymentEvents,
  planPrices,
  subscriptionPlans,
  subscriptions,
  usageLogs,
  userQuotas,
} from '../../db/schema.js';

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

export async function addPurchasedCredits(d1, { userId, projectId, packageName, credits, pricePaidCents, platform, externalId }) {
  const db = getDb(d1);
  await ensureUserQuota(d1, { userId, projectId });

  const existing = await db
    .select({ id: creditPurchases.id })
    .from(creditPurchases)
    .where(and(eq(creditPurchases.platform, platform), eq(creditPurchases.externalId, externalId)))
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
        (user_id, package_name, credits_amount, price_paid_cents, platform, external_id, status, project_id)
      VALUES (?, ?, ?, ?, ?, ?, 'completed', ?)
    `).bind(Number(userId), packageName, credits, pricePaidCents, platform, externalId, projectId),
    d1.prepare(`
      INSERT OR IGNORE INTO credit_transactions
        (user_id, project_id, type, source, amount, platform, external_id, metadata)
      VALUES (?, ?, 'purchase', 'purchased', ?, ?, ?, ?)
    `).bind(
      Number(userId),
      projectId,
      credits,
      platform,
      externalId,
      JSON.stringify({ packageName, pricePaidCents }),
    ),
  ]);

  return { applied: true };
}

export async function createPendingCreditPurchase(d1, {
  userId,
  projectId,
  packageName,
  credits,
  pricePaidCents,
  platform,
  externalId,
}) {
  const db = getDb(d1);
  await ensureUserQuota(d1, { userId, projectId });

  await db
    .insert(creditPurchases)
    .values({
      userId: Number(userId),
      projectId,
      packageName,
      creditsAmount: credits,
      pricePaidCents,
      platform,
      externalId,
      status: 'pending',
    })
    .onConflictDoNothing({
      target: [creditPurchases.platform, creditPurchases.externalId],
    })
    .run();

  return getCreditPurchaseByExternalId(d1, { projectId, platform, externalId });
}

export async function getCreditPurchaseByExternalId(d1, { projectId, platform, externalId }) {
  return getDb(d1)
    .select()
    .from(creditPurchases)
    .where(and(
      eq(creditPurchases.projectId, projectId),
      eq(creditPurchases.platform, platform),
      eq(creditPurchases.externalId, externalId),
    ))
    .get();
}

export async function completeCreditPurchase(d1, { projectId, platform, externalId, amountPaidCents, metadata }) {
  const purchase = await getCreditPurchaseByExternalId(d1, { projectId, platform, externalId });
  if (!purchase) {
    return { applied: false, reason: 'purchase_not_found' };
  }

  if (purchase.pricePaidCents !== amountPaidCents) {
    return { applied: false, reason: 'amount_mismatch' };
  }

  if (purchase.status === 'completed') {
    return { applied: false, reason: 'already_completed', purchase };
  }

  if (purchase.status !== 'pending') {
    return { applied: false, reason: `invalid_status:${purchase.status}` };
  }

  const metadataJson = JSON.stringify({
    packageName: purchase.packageName,
    pricePaidCents: purchase.pricePaidCents,
    ...(metadata || {}),
  });

  await d1.batch([
    d1.prepare(`
      UPDATE user_quotas
      SET credits_purchased = credits_purchased + ?,
          total_purchased = total_purchased + ?,
          updated_at = datetime('now')
      WHERE user_id = ? AND project_id = ?
        AND EXISTS (
          SELECT 1 FROM credit_purchases
          WHERE project_id = ?
            AND platform = ?
            AND external_id = ?
            AND status = 'pending'
        )
    `).bind(
      purchase.creditsAmount,
      purchase.creditsAmount,
      purchase.userId,
      projectId,
      projectId,
      platform,
      externalId,
    ),
    d1.prepare(`
      INSERT OR IGNORE INTO credit_transactions
        (user_id, project_id, type, source, amount, platform, external_id, metadata)
      SELECT ?, ?, 'purchase', 'purchased', ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM credit_purchases
        WHERE project_id = ?
          AND platform = ?
          AND external_id = ?
          AND status = 'pending'
      )
    `).bind(
      purchase.userId,
      projectId,
      purchase.creditsAmount,
      platform,
      externalId,
      metadataJson,
      projectId,
      platform,
      externalId,
    ),
    d1.prepare(`
      UPDATE credit_purchases
      SET status = 'completed',
          updated_at = datetime('now')
      WHERE project_id = ?
        AND platform = ?
        AND external_id = ?
        AND status = 'pending'
    `).bind(projectId, platform, externalId),
  ]);

  return { applied: true, purchase };
}

export async function getPlan(d1, { planId, projectId }) {
  return getDb(d1)
    .select()
    .from(subscriptionPlans)
    .where(and(eq(subscriptionPlans.id, planId), eq(subscriptionPlans.projectId, projectId)))
    .get();
}

export async function getPlanByPriceExternalId(d1, { projectId, platform, externalId }) {
  return getDb(d1)
    .select({
      planId: subscriptionPlans.id,
      name: subscriptionPlans.name,
      creditsMonthly: subscriptionPlans.creditsMonthly,
      interval: planPrices.interval,
      currency: planPrices.currency,
      amountCents: planPrices.amountCents,
    })
    .from(planPrices)
    .innerJoin(subscriptionPlans, and(
      eq(planPrices.planId, subscriptionPlans.id),
      eq(planPrices.projectId, subscriptionPlans.projectId),
    ))
    .where(and(
      eq(planPrices.projectId, projectId),
      eq(planPrices.platform, platform),
      eq(planPrices.externalId, externalId),
      eq(planPrices.isActive, 1),
      eq(subscriptionPlans.isActive, 1),
    ))
    .get();
}

export async function listPlanPrices(d1, { projectId, platform }) {
  return getDb(d1)
    .select({
      id: planPrices.id,
      planId: planPrices.planId,
      platform: planPrices.platform,
      externalId: planPrices.externalId,
      interval: planPrices.interval,
      currency: planPrices.currency,
      amountCents: planPrices.amountCents,
      creditsMonthly: subscriptionPlans.creditsMonthly,
    })
    .from(planPrices)
    .innerJoin(subscriptionPlans, and(
      eq(planPrices.planId, subscriptionPlans.id),
      eq(planPrices.projectId, subscriptionPlans.projectId),
    ))
    .where(and(
      eq(planPrices.projectId, projectId),
      eq(planPrices.platform, platform),
      eq(planPrices.isActive, 1),
      eq(subscriptionPlans.isActive, 1),
    ));
}

export async function recordPaymentEvent(d1, { projectId, platform, externalId, eventType, resourceType, resourceId, payload }) {
  const db = getDb(d1);
  const result = await db
    .insert(paymentEvents)
    .values({
      projectId,
      platform,
      externalId,
      eventType,
      resourceType,
      resourceId,
      payload: payload ? JSON.stringify(payload) : null,
    })
    .onConflictDoNothing({
      target: [paymentEvents.platform, paymentEvents.externalId],
    })
    .run();

  return { inserted: Boolean(result.meta?.changes) };
}

export async function markPaymentEventProcessed(d1, { platform, externalId, status = 'processed' }) {
  await getDb(d1)
    .update(paymentEvents)
    .set({ status, processedAt: sql`datetime('now')` })
    .where(and(eq(paymentEvents.platform, platform), eq(paymentEvents.externalId, externalId)))
    .run();
}

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

export async function activateUserSubscription(d1, { userId, projectId, planId, platform, externalId, monthlyCredits }) {
  const db = getDb(d1);
  await ensureUserQuota(d1, { userId, projectId });

  const now = new Date();
  const periodStart = now.toISOString();
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()).toISOString();

  await db
    .insert(subscriptions)
    .values({
      userId: Number(userId),
      projectId,
      planId,
      platform,
      externalId,
      status: 'active',
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    })
    .onConflictDoUpdate({
      target: [subscriptions.platform, subscriptions.externalId],
      set: {
        userId: Number(userId),
        projectId,
        planId,
        status: 'active',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        updatedAt: sql`datetime('now')`,
      },
    })
    .run();

  await db
    .update(userQuotas)
    .set({
      planId,
      creditsMonthly: monthlyCredits,
      periodStart,
      periodEnd,
      periodUsed: 0,
      updatedAt: sql`datetime('now')`,
    })
    .where(and(eq(userQuotas.userId, Number(userId)), eq(userQuotas.projectId, projectId)))
    .run();

  await db
    .insert(creditTransactions)
    .values({
      userId: Number(userId),
      projectId,
      type: 'subscription',
      source: 'monthly',
      amount: monthlyCredits,
      platform,
      externalId: `subscription:${externalId}:${periodStart}`,
      metadata: JSON.stringify({ planId }),
    })
    .onConflictDoNothing({
      target: [creditTransactions.projectId, creditTransactions.platform, creditTransactions.externalId],
    })
    .run();
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

  await db
    .update(subscriptions)
    .set({ status, updatedAt: sql`datetime('now')` })
    .where(and(eq(subscriptions.externalId, externalId), eq(subscriptions.projectId, projectId)))
    .run();

  if (clearSubscription && subscription) {
    await db
      .update(userQuotas)
      .set({ creditsMonthly: 0, periodUsed: 0, updatedAt: sql`datetime('now')` })
      .where(and(eq(userQuotas.userId, subscription.userId), eq(userQuotas.projectId, projectId)))
      .run();
  }
}

export async function renewSubscriptionPeriod(d1, { projectId, externalId, periodEnd }) {
  const db = getDb(d1);
  const subscription = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.externalId, externalId), eq(subscriptions.projectId, projectId)))
    .get();

  if (!subscription) return;

  await db
    .update(subscriptions)
    .set({
      currentPeriodEnd: periodEnd,
      status: 'active',
      updatedAt: sql`datetime('now')`,
    })
    .where(and(eq(subscriptions.externalId, externalId), eq(subscriptions.projectId, projectId)))
    .run();

  await db
    .update(userQuotas)
    .set({
      periodEnd,
      periodUsed: 0,
      updatedAt: sql`datetime('now')`,
    })
    .where(and(eq(userQuotas.userId, subscription.userId), eq(userQuotas.projectId, projectId)))
    .run();
}
