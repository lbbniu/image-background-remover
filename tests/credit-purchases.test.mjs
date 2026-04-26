import test from 'node:test';
import assert from 'node:assert/strict';
import {
  completeCreditPurchase,
  createPendingCreditPurchase,
  getCreditPurchaseByExternalId,
} from '../functions/lib/payments/credit-purchases.js';
import { createSchemaBackedD1 } from './d1-test-db.mjs';

async function createUser(d1) {
  await d1.prepare(`
    INSERT INTO users (email, name)
    VALUES ('buyer@example.com', 'Buyer')
  `).run();

  const user = await d1.prepare('SELECT id FROM users WHERE email = ?').bind('buyer@example.com').get();
  return user.id;
}

async function getQuota(d1, userId) {
  return d1
    .prepare('SELECT credits_purchased, total_purchased FROM user_quotas WHERE user_id = ? AND project_id = ?')
    .bind(userId, 'clearcut')
    .get();
}

async function countPurchaseTransactions(d1, externalId) {
  const row = await d1
    .prepare(`
      SELECT COUNT(*) AS count
      FROM credit_transactions
      WHERE project_id = 'clearcut'
        AND platform = 'paypal'
        AND external_id = ?
        AND type = 'purchase'
    `)
    .bind(externalId)
    .get();

  return row.count;
}

test('credit purchase is pending before PayPal confirmation', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const userId = await createUser(d1);

    const purchase = await createPendingCreditPurchase(d1, {
      userId,
      projectId: 'clearcut',
      packageName: '50 Credits',
      credits: 50,
      pricePaidCents: 499,
      platform: 'paypal',
      externalId: 'ORDER-PENDING',
    });

    const quota = await getQuota(d1, userId);
    assert.equal(purchase.status, 'pending');
    assert.equal(quota.credits_purchased, 0);
    assert.equal(await countPurchaseTransactions(d1, 'ORDER-PENDING'), 0);
  } finally {
    d1.close();
  }
});

test('completed PayPal order applies purchased credits exactly once', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const userId = await createUser(d1);
    await createPendingCreditPurchase(d1, {
      userId,
      projectId: 'clearcut',
      packageName: '200 Credits',
      credits: 200,
      pricePaidCents: 1499,
      platform: 'paypal',
      externalId: 'ORDER-PAID',
    });

    const first = await completeCreditPurchase(d1, {
      projectId: 'clearcut',
      platform: 'paypal',
      externalId: 'ORDER-PAID',
      amountPaidCents: 1499,
      metadata: { confirmation: 'test' },
    });
    const second = await completeCreditPurchase(d1, {
      projectId: 'clearcut',
      platform: 'paypal',
      externalId: 'ORDER-PAID',
      amountPaidCents: 1499,
      metadata: { confirmation: 'duplicate' },
    });

    const purchase = await getCreditPurchaseByExternalId(d1, {
      projectId: 'clearcut',
      platform: 'paypal',
      externalId: 'ORDER-PAID',
    });
    const quota = await getQuota(d1, userId);

    assert.equal(first.applied, true);
    assert.equal(second.applied, false);
    assert.equal(second.reason, 'already_completed');
    assert.equal(purchase.status, 'completed');
    assert.equal(quota.credits_purchased, 200);
    assert.equal(quota.total_purchased, 200);
    assert.equal(await countPurchaseTransactions(d1, 'ORDER-PAID'), 1);
  } finally {
    d1.close();
  }
});

test('amount mismatch does not apply credits', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const userId = await createUser(d1);
    await createPendingCreditPurchase(d1, {
      userId,
      projectId: 'clearcut',
      packageName: '500 Credits',
      credits: 500,
      pricePaidCents: 2999,
      platform: 'paypal',
      externalId: 'ORDER-MISMATCH',
    });

    const result = await completeCreditPurchase(d1, {
      projectId: 'clearcut',
      platform: 'paypal',
      externalId: 'ORDER-MISMATCH',
      amountPaidCents: 499,
    });
    const purchase = await getCreditPurchaseByExternalId(d1, {
      projectId: 'clearcut',
      platform: 'paypal',
      externalId: 'ORDER-MISMATCH',
    });
    const quota = await getQuota(d1, userId);

    assert.equal(result.applied, false);
    assert.equal(result.reason, 'amount_mismatch');
    assert.equal(purchase.status, 'pending');
    assert.equal(quota.credits_purchased, 0);
    assert.equal(await countPurchaseTransactions(d1, 'ORDER-MISMATCH'), 0);
  } finally {
    d1.close();
  }
});

test('unknown PayPal order cannot apply credits', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const result = await completeCreditPurchase(d1, {
      projectId: 'clearcut',
      platform: 'paypal',
      externalId: 'ORDER-UNKNOWN',
      amountPaidCents: 499,
    });

    assert.equal(result.applied, false);
    assert.equal(result.reason, 'purchase_not_found');
    assert.equal(await countPurchaseTransactions(d1, 'ORDER-UNKNOWN'), 0);
  } finally {
    d1.close();
  }
});
