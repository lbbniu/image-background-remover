import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumeCredit,
  ensureUserQuota,
  getUserCreditBalance,
  refundCredit,
} from '../foundation/modules/credits/index.js';
import {
  activateUserSubscription,
  cancelUserSubscription,
  renewSubscriptionPeriod,
} from '../foundation/modules/subscriptions/index.js';
import { createSchemaBackedD1 } from './d1-test-db.mjs';

async function createUser(d1, email = 'concurrent@example.com') {
  await d1.prepare('INSERT INTO users (email, name) VALUES (?, ?)').bind(email, 'Concurrent User').run();
  return d1.prepare('SELECT id, email FROM users WHERE email = ?').bind(email).get();
}

async function getQuota(d1, userId) {
  return d1
    .prepare('SELECT * FROM user_quotas WHERE user_id = ? AND project_id = ?')
    .bind(userId, 'clearcut')
    .get();
}

test('parallel consumeCredit with same jobId only deducts once', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    await ensureUserQuota(d1, { userId: user.id, projectId: 'clearcut', giftedCredits: 10 });

    const results = await Promise.all([
      consumeCredit(d1, { userId: user.id, projectId: 'clearcut', jobId: 'race-1', credits: 3, consumeOrder: ['gifted'] }),
      consumeCredit(d1, { userId: user.id, projectId: 'clearcut', jobId: 'race-1', credits: 3, consumeOrder: ['gifted'] }),
    ]);

    const successes = results.filter((r) => r.success && !r.idempotent);
    const idempotent = results.filter((r) => r.idempotent === true);
    // 输者可能在 winner 翻 pending→success 之前观察到行仍是 pending，返回 job_pending；
    // 这也是合法的并发结果。关键不变量：只发生一次扣费 + 一次成功 + 一条 success 流水。
    const inProgress = results.filter((r) => r.error === 'job_pending');

    assert.equal(successes.length, 1);
    assert.equal(successes.length + idempotent.length + inProgress.length, results.length);

    const quota = await getQuota(d1, user.id);
    assert.equal(quota.credits_gifted, 7);
    assert.equal(quota.total_used, 3);

    const txCount = await d1
      .prepare(`SELECT COUNT(*) AS count FROM credit_transactions
                WHERE platform = 'internal' AND external_id = 'race-1'`)
      .get();
    assert.equal(txCount.count, 1);
  } finally {
    d1.close();
  }
});

test('parallel refundCredit only refunds once', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    await ensureUserQuota(d1, { userId: user.id, projectId: 'clearcut', giftedCredits: 10 });
    await consumeCredit(d1, {
      userId: user.id,
      projectId: 'clearcut',
      jobId: 'refund-race',
      credits: 4,
      consumeOrder: ['gifted'],
    });

    const refunds = await Promise.all([
      refundCredit(d1, { userId: user.id, projectId: 'clearcut', jobId: 'refund-race' }),
      refundCredit(d1, { userId: user.id, projectId: 'clearcut', jobId: 'refund-race' }),
    ]);

    const refunded = refunds.filter((r) => r.refunded === true);
    assert.equal(refunded.length, 1);

    const quota = await getQuota(d1, user.id);
    assert.equal(quota.credits_gifted, 10);
    assert.equal(quota.total_used, 0);

    const txCount = await d1
      .prepare(`SELECT COUNT(*) AS count FROM credit_transactions
                WHERE platform = 'internal' AND external_id = 'refund:refund-race'`)
      .get();
    assert.equal(txCount.count, 1);
  } finally {
    d1.close();
  }
});

test('consumeCredit cannot succeed after a job has been refunded', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    await ensureUserQuota(d1, { userId: user.id, projectId: 'clearcut', giftedCredits: 10 });
    await consumeCredit(d1, {
      userId: user.id,
      projectId: 'clearcut',
      jobId: 'job-replay',
      credits: 2,
      consumeOrder: ['gifted'],
    });
    await refundCredit(d1, { userId: user.id, projectId: 'clearcut', jobId: 'job-replay' });

    const replay = await consumeCredit(d1, {
      userId: user.id,
      projectId: 'clearcut',
      jobId: 'job-replay',
      credits: 2,
      consumeOrder: ['gifted'],
    });

    assert.equal(replay.success, false);
    assert.equal(replay.error, 'job_refunded');
  } finally {
    d1.close();
  }
});

test('renewSubscriptionPeriod resets monthly credits and writes ledger when monthlyCredits provided', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    await activateUserSubscription(d1, {
      userId: user.id,
      projectId: 'clearcut',
      planId: 'pro',
      platform: 'creem',
      externalId: 'sub_renew',
      monthlyCredits: 300,
    });

    // 模拟用户消耗了一些月度额度
    await d1
      .prepare(`UPDATE user_quotas SET period_used = 100 WHERE user_id = ? AND project_id = ?`)
      .bind(user.id, 'clearcut')
      .run();

    const next = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();
    const result = await renewSubscriptionPeriod(d1, {
      projectId: 'clearcut',
      externalId: 'sub_renew',
      periodEnd: next,
      monthlyCredits: 300,
      planId: 'pro',
    });

    assert.equal(result.renewed, true);

    const quota = await getQuota(d1, user.id);
    assert.equal(quota.credits_monthly, 300);
    assert.equal(quota.period_used, 0);

    const ledger = await d1
      .prepare(`SELECT COUNT(*) AS count FROM credit_transactions
                WHERE type = 'subscription' AND platform = 'creem'
                  AND external_id LIKE 'subscription:sub_renew:%'`)
      .get();
    assert.equal(ledger.count, 2); // 激活 + 续期
  } finally {
    d1.close();
  }
});

test('activateUserSubscription deactivates a previously active subscription for the same user', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    await activateUserSubscription(d1, {
      userId: user.id,
      projectId: 'clearcut',
      planId: 'pro',
      platform: 'creem',
      externalId: 'sub_old',
      monthlyCredits: 300,
    });
    await activateUserSubscription(d1, {
      userId: user.id,
      projectId: 'clearcut',
      planId: 'business',
      platform: 'creem',
      externalId: 'sub_new',
      monthlyCredits: 1000,
    });

    const rows = await d1
      .prepare(`SELECT external_id, status FROM subscriptions WHERE user_id = ? AND project_id = 'clearcut'`)
      .bind(user.id)
      .all();
    const map = Object.fromEntries(rows.results.map((r) => [r.external_id, r.status]));
    assert.equal(map.sub_old, 'expired');
    assert.equal(map.sub_new, 'active');
  } finally {
    d1.close();
  }
});

test('refundCredit rejects when caller userId mismatches usage_log owner', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1, 'a@example.com');
    const other = await createUser(d1, 'b@example.com');
    await ensureUserQuota(d1, { userId: user.id, projectId: 'clearcut', giftedCredits: 5 });
    await ensureUserQuota(d1, { userId: other.id, projectId: 'clearcut', giftedCredits: 5 });
    await consumeCredit(d1, {
      userId: user.id,
      projectId: 'clearcut',
      jobId: 'auth-job',
      credits: 2,
      consumeOrder: ['gifted'],
    });

    // 越权调用：用 other.id 退 user 的 job
    const result = await refundCredit(d1, { userId: other.id, projectId: 'clearcut', jobId: 'auth-job' });
    assert.equal(result.refunded, false);
    assert.equal(result.error, 'user_mismatch');

    // 受害者（user）的额度未被还回
    const userQuota = await getQuota(d1, user.id);
    assert.equal(userQuota.credits_gifted, 3);
    // 攻击者（other）的额度也没有被多发
    const otherQuota = await getQuota(d1, other.id);
    assert.equal(otherQuota.credits_gifted, 5);
  } finally {
    d1.close();
  }
});

test('getCurrentSubscription prefers active over older cancelled history', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    // 旧订阅：先激活后取消（立即取消，留下 cancelled 行）
    await activateUserSubscription(d1, {
      userId: user.id,
      projectId: 'clearcut',
      planId: 'pro',
      platform: 'creem',
      externalId: 'sub_legacy',
      monthlyCredits: 100,
    });
    await cancelUserSubscription(d1, { userId: user.id, projectId: 'clearcut', externalId: 'sub_legacy', immediate: true });

    // 新订阅：再次 active
    await activateUserSubscription(d1, {
      userId: user.id,
      projectId: 'clearcut',
      planId: 'business',
      platform: 'creem',
      externalId: 'sub_current',
      monthlyCredits: 1000,
    });

    // getUserCreditBalance 内部走 getCurrentSubscription：应当看到 active 订阅
    const balance = await getUserCreditBalance(d1, { userId: user.id, projectId: 'clearcut' });
    assert.equal(balance.subscriptionStatus, 'active');
    assert.equal(balance.plan, 'business');
  } finally {
    d1.close();
  }
});

test('cancelUserSubscription default keeps active until period end', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    await activateUserSubscription(d1, {
      userId: user.id,
      projectId: 'clearcut',
      planId: 'pro',
      platform: 'creem',
      externalId: 'sub_eop',
      monthlyCredits: 100,
    });
    await cancelUserSubscription(d1, { userId: user.id, projectId: 'clearcut', externalId: 'sub_eop' });

    const sub = await d1
      .prepare(`SELECT status, cancel_at_period_end FROM subscriptions WHERE external_id = ?`)
      .bind('sub_eop')
      .get();
    assert.equal(sub.status, 'active');
    assert.equal(sub.cancel_at_period_end, 1);

    // 把周期人为推到过去：refresh 必须不再续费 → 月度额度归零
    await d1
      .prepare(`UPDATE user_quotas SET period_end = ? WHERE user_id = ? AND project_id = ?`)
      .bind(new Date(Date.now() - 60_000).toISOString(), user.id, 'clearcut')
      .run();

    const balance = await getUserCreditBalance(d1, { userId: user.id, projectId: 'clearcut' });
    assert.equal(balance.monthlyRemaining, 0);

    const subAfter = await d1
      .prepare(`SELECT status FROM subscriptions WHERE external_id = ?`).bind('sub_eop').get();
    assert.equal(subAfter.status, 'expired');
  } finally {
    d1.close();
  }
});

test('refreshSubscriptionPeriod catches up multiple missed periods in one call', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    // 注入 plan 行，让 getPlanMonthlyCredits 返回 200（schema 已 seed 同 id 的 plan，用 REPLACE 覆盖）
    await d1
      .prepare(`INSERT OR REPLACE INTO subscription_plans (id, project_id, name, credits_monthly, price_monthly)
                VALUES ('pro', 'clearcut', 'Pro', 200, 1000)`)
      .run();

    await activateUserSubscription(d1, {
      userId: user.id,
      projectId: 'clearcut',
      planId: 'pro',
      platform: 'creem',
      externalId: 'sub_long_offline',
      monthlyCredits: 200,
    });

    // 模拟 webhook 故障：把 periodEnd 拨到 90 天之前
    const longAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    await d1
      .prepare(`UPDATE user_quotas SET period_end = ? WHERE user_id = ? AND project_id = ?`)
      .bind(longAgo, user.id, 'clearcut')
      .run();
    await d1
      .prepare(`UPDATE subscriptions SET current_period_end = ? WHERE external_id = ?`)
      .bind(longAgo, 'sub_long_offline')
      .run();

    const balance = await getUserCreditBalance(d1, { userId: user.id, projectId: 'clearcut' });

    // 周期已被推到当前时刻附近
    assert.ok(new Date(balance.periodEnd).getTime() > Date.now());

    // 期间补齐的所有月度流水都写入了（>=2 条说明补了多个月）
    const ledger = await d1
      .prepare(`SELECT COUNT(*) AS count FROM credit_transactions
                WHERE type = 'subscription' AND platform = 'creem'
                  AND external_id LIKE 'subscription:sub_long_offline:%'`)
      .get();
    assert.ok(ledger.count >= 2, `expected catch-up ledger entries, got ${ledger.count}`);
  } finally {
    d1.close();
  }
});
