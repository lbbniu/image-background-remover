import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumeCredit,
  ensureUserQuota,
  refundCredit,
} from '../foundation/modules/credits/index.js';
import { activateUserSubscription } from '../foundation/modules/subscriptions/index.js';
import { createSchemaBackedD1 } from './d1-test-db.mjs';

async function createUser(d1, email = 'atomic@example.com') {
  await d1.prepare('INSERT INTO users (email, name) VALUES (?, ?)').bind(email, 'Atomic User').run();
  return d1.prepare('SELECT id, email FROM users WHERE email = ?').bind(email).get();
}

async function getQuota(d1, userId) {
  return d1
    .prepare('SELECT * FROM user_quotas WHERE user_id = ? AND project_id = ?')
    .bind(userId, 'clearcut')
    .get();
}

async function countTransactions(d1, externalId, type) {
  const row = await d1
    .prepare(`
      SELECT COUNT(*) AS count
      FROM credit_transactions
      WHERE project_id = 'clearcut'
        AND external_id = ?
        AND type = ?
    `)
    .bind(externalId, type)
    .get();
  return row.count;
}

test('consumeCredit is idempotent by job id and writes usage with transaction', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    await ensureUserQuota(d1, { userId: user.id, projectId: 'clearcut', giftedCredits: 10 });

    const first = await consumeCredit(d1, {
      userId: user.id,
      projectId: 'clearcut',
      jobId: 'job-idempotent',
      credits: 3,
      consumeOrder: ['gifted'],
    });
    const second = await consumeCredit(d1, {
      userId: user.id,
      projectId: 'clearcut',
      jobId: 'job-idempotent',
      credits: 3,
      consumeOrder: ['gifted'],
    });

    const quota = await getQuota(d1, user.id);
    const usage = await d1.prepare('SELECT * FROM usage_logs WHERE job_id = ?').bind('job-idempotent').get();

    assert.equal(first.success, true);
    assert.equal(second.success, true);
    assert.equal(second.idempotent, true);
    assert.equal(quota.credits_gifted, 7);
    assert.equal(quota.total_used, 3);
    assert.equal(usage.status, 'success');
    assert.equal(usage.source, 'gifted');
    assert.equal(await countTransactions(d1, 'job-idempotent', 'consume'), 1);
  } finally {
    d1.close();
  }
});

test('refundCredit is idempotent and restores original source once', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    await ensureUserQuota(d1, { userId: user.id, projectId: 'clearcut', giftedCredits: 10 });
    await consumeCredit(d1, {
      userId: user.id,
      projectId: 'clearcut',
      jobId: 'job-refund',
      credits: 4,
      consumeOrder: ['gifted'],
    });

    const first = await refundCredit(d1, {
      userId: user.id,
      projectId: 'clearcut',
      jobId: 'job-refund',
      metadata: { reason: 'test' },
    });
    const second = await refundCredit(d1, {
      userId: user.id,
      projectId: 'clearcut',
      jobId: 'job-refund',
      metadata: { reason: 'duplicate' },
    });

    const quota = await getQuota(d1, user.id);
    const usage = await d1.prepare('SELECT * FROM usage_logs WHERE job_id = ?').bind('job-refund').get();

    assert.equal(first.refunded, true);
    assert.equal(second.refunded, false);
    assert.equal(quota.credits_gifted, 10);
    assert.equal(quota.total_used, 0);
    assert.equal(usage.status, 'refunded');
    assert.equal(await countTransactions(d1, 'refund:job-refund', 'refund'), 1);
  } finally {
    d1.close();
  }
});

test('activateUserSubscription updates subscription, quota, and ledger together', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    await activateUserSubscription(d1, {
      userId: user.id,
      projectId: 'clearcut',
      planId: 'pro',
      platform: 'creem',
      externalId: 'sub_atomic',
      monthlyCredits: 300,
    });

    const quota = await getQuota(d1, user.id);
    const subscription = await d1
      .prepare('SELECT * FROM subscriptions WHERE platform = ? AND external_id = ?')
      .bind('creem', 'sub_atomic')
      .get();
    const ledger = await d1
      .prepare(`
        SELECT COUNT(*) AS count
        FROM credit_transactions
        WHERE platform = 'creem'
          AND external_id LIKE 'subscription:sub_atomic:%'
          AND type = 'subscription'
      `)
      .get();

    assert.equal(subscription.status, 'active');
    assert.equal(subscription.plan_id, 'pro');
    assert.equal(quota.plan_id, 'pro');
    assert.equal(quota.credits_monthly, 300);
    assert.equal(quota.period_used, 0);
    assert.equal(ledger.count, 1);
  } finally {
    d1.close();
  }
});

