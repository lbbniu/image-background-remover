import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '../../../db/client.js';
import { creditPackages, creditPurchases } from '../../../db/schema.js';
import {
  CREDIT_SOURCES,
  CREDIT_TX_TYPES,
  PURCHASE_STATUS,
} from '../core/constants.js';
import { ensureUserQuota } from '../credits/service.js';

function parseMetadata(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toCreditPackage(row) {
  if (!row) return null;
  return {
    id: row.packageId,
    packageId: row.packageId,
    name: row.name,
    label: row.name,
    credits: row.credits,
    platform: row.platform,
    externalId: row.externalId,
    currency: row.currency,
    amountCents: row.amountCents,
    price: (row.amountCents / 100).toFixed(2),
    badge: row.badge,
    metadata: parseMetadata(row.metadata),
  };
}

export async function listCreditPackages(d1, { projectId, platform }) {
  if (!platform) throw new Error('listCreditPackages: platform is required');
  const rows = await getDb(d1)
    .select()
    .from(creditPackages)
    .where(and(
      eq(creditPackages.projectId, projectId),
      eq(creditPackages.platform, platform),
      eq(creditPackages.isActive, 1),
    ))
    .orderBy(asc(creditPackages.sortOrder), asc(creditPackages.credits));

  return rows.map(toCreditPackage);
}

export async function getCreditPackage(d1, { projectId, platform, packageId }) {
  if (!platform || !packageId) throw new Error('getCreditPackage: platform and packageId are required');
  const row = await getDb(d1)
    .select()
    .from(creditPackages)
    .where(and(
      eq(creditPackages.projectId, projectId),
      eq(creditPackages.platform, platform),
      eq(creditPackages.packageId, packageId),
      eq(creditPackages.isActive, 1),
    ))
    .get();

  return toCreditPackage(row);
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

// 新接口：直接用 packageId 创建 pending purchase。包内字段（credits / 价格）由 creditPackages 表派生，
// 调用方不能再篡改单价/积分数量。
export async function createPendingCreditPurchaseByPackage(d1, {
  userId,
  projectId,
  platform,
  packageId,
  externalId,
}) {
  const pack = await getCreditPackage(d1, { projectId, platform, packageId });
  if (!pack) {
    throw new Error(`Credit package not found: ${platform}/${packageId}`);
  }
  return createPendingCreditPurchase(d1, {
    userId,
    projectId,
    packageName: pack.label,
    credits: pack.credits,
    pricePaidCents: pack.amountCents,
    platform,
    externalId,
  });
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
  if (!externalId) throw new Error('createPendingCreditPurchase: externalId is required');
  const safeCredits = Math.max(1, Math.floor(Number(credits) || 0));
  const safePrice = Math.max(0, Math.floor(Number(pricePaidCents) || 0));

  const db = getDb(d1);
  await ensureUserQuota(d1, { userId, projectId, giftedCredits: 0 });

  await db
    .insert(creditPurchases)
    .values({
      userId: Number(userId),
      projectId,
      packageName,
      creditsAmount: safeCredits,
      pricePaidCents: safePrice,
      platform,
      externalId,
      status: PURCHASE_STATUS.pending,
    })
    .onConflictDoNothing({
      target: [creditPurchases.platform, creditPurchases.externalId],
    })
    .run();

  return getCreditPurchaseByExternalId(d1, { projectId, platform, externalId });
}

// 旧接口：直接发放积分（无 pending 中间状态），保留供没有 webhook 的渠道使用，
// 内部仍然通过原子的 status 转换防止重复入账。
export async function addPurchasedCredits(d1, {
  userId,
  projectId,
  packageName,
  credits,
  pricePaidCents,
  platform,
  externalId,
}) {
  const pending = await createPendingCreditPurchase(d1, {
    userId,
    projectId,
    packageName,
    credits,
    pricePaidCents,
    platform,
    externalId,
  });
  if (!pending) return { applied: false, reason: 'duplicate_payment' };
  if (pending.status !== PURCHASE_STATUS.pending) {
    return { applied: false, reason: pending.status };
  }
  return completeCreditPurchase(d1, {
    projectId,
    platform,
    externalId,
    amountPaidCents: pending.pricePaidCents,
  });
}

// amountPaidCents < pricePaidCents 视为支付不足，拒绝；
// 等于或多付（例如含税）则按 pending 行的 credits 发放，多余金额计入流水 metadata。
export async function completeCreditPurchase(d1, {
  projectId,
  platform,
  externalId,
  amountPaidCents,
  metadata,
}) {
  const purchase = await getCreditPurchaseByExternalId(d1, { projectId, platform, externalId });
  if (!purchase) return { applied: false, reason: 'purchase_not_found' };

  if (purchase.status === PURCHASE_STATUS.completed) {
    return { applied: false, reason: 'already_completed', purchase };
  }
  if (purchase.status !== PURCHASE_STATUS.pending) {
    return { applied: false, reason: `invalid_status:${purchase.status}` };
  }

  const paid = Math.max(0, Math.floor(Number(amountPaidCents) || 0));
  if (paid < purchase.pricePaidCents) {
    return { applied: false, reason: 'amount_mismatch' };
  }

  const txMetadata = JSON.stringify({
    packageName: purchase.packageName,
    pricePaidCents: purchase.pricePaidCents,
    amountPaidCents: paid,
    overpaidCents: paid - purchase.pricePaidCents,
    ...(metadata || {}),
  });

  // 1) 抢占：把 pending 翻成 completed，仅一次成功
  const claim = await d1.prepare(`
    UPDATE credit_purchases
    SET status = 'completed', updated_at = datetime('now')
    WHERE project_id = ?
      AND platform = ?
      AND external_id = ?
      AND status = 'pending'
  `).bind(projectId, platform, externalId).run();

  if (!claim.meta?.changes) {
    const fresh = await getCreditPurchaseByExternalId(d1, { projectId, platform, externalId });
    if (fresh?.status === PURCHASE_STATUS.completed) {
      return { applied: false, reason: 'already_completed', purchase: fresh };
    }
    return { applied: false, reason: 'claim_failed', purchase: fresh };
  }

  // 2) 入账 + 写流水
  await d1.batch([
    d1.prepare(`
      UPDATE user_quotas
      SET credits_purchased = credits_purchased + ?,
          total_purchased = total_purchased + ?,
          updated_at = datetime('now')
      WHERE user_id = ? AND project_id = ?
    `).bind(purchase.creditsAmount, purchase.creditsAmount, purchase.userId, projectId),
    d1.prepare(`
      INSERT OR IGNORE INTO credit_transactions
        (user_id, project_id, type, source, amount, platform, external_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      purchase.userId,
      projectId,
      CREDIT_TX_TYPES.purchase,
      CREDIT_SOURCES.purchased,
      purchase.creditsAmount,
      platform,
      externalId,
      txMetadata,
    ),
  ]);

  return { applied: true, purchase: { ...purchase, status: PURCHASE_STATUS.completed } };
}
