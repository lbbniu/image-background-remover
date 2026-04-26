import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../../../db/client.js';
import { creditTransactions, subscriptions, userQuotas } from '../../../db/schema.js';
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
