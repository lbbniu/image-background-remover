import { and, eq } from 'drizzle-orm';
import { getDb } from '../../../db/client.js';
import { creditPurchases } from '../../../db/schema.js';
import { ensureUserQuota } from '../credits/service.js';

export function getCreditPackages() {
  return {
    '50': { credits: 50, price: '4.99', label: '50 Credits' },
    '200': { credits: 200, price: '14.99', label: '200 Credits' },
    '500': { credits: 500, price: '29.99', label: '500 Credits' },
  };
}

export async function addPurchasedCredits(d1, {
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
