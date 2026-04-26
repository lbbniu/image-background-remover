import { and, eq } from 'drizzle-orm';
import { getDb } from '../../../db/client.js';
import { planPrices, subscriptionPlans } from '../../../db/schema.js';

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
