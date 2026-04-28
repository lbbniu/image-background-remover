import test from 'node:test';
import assert from 'node:assert/strict';
import { signJWT } from '../foundation/modules/auth/index.js';
import { createPendingCreditPurchase } from '../foundation/modules/payments/index.js';
import { onRequestPost as createCheckoutSessionHandler } from '../functions/api/credit-purchases/checkout-sessions.js';
import { onRequestPost as confirmCheckoutSessionHandler } from '../functions/api/credit-purchases/checkout-sessions/[sessionId]/confirm.js';
import { onRequestPost as subscriptionHandler } from '../functions/api/subscriptions.js';
import { createSchemaBackedD1 } from './d1-test-db.mjs';

const JWT_SECRET = 'test-secret';

async function createUser(d1, email = 'mock-buyer@example.com') {
  await d1.prepare('INSERT INTO users (email, name) VALUES (?, ?)').bind(email, 'Mock Buyer').run();
  return d1.prepare('SELECT id, email FROM users WHERE email = ?').bind(email).get();
}

async function authCookie(user) {
  const token = await signJWT({ sub: String(user.id), email: user.email, name: 'Mock Buyer' }, JWT_SECRET);
  return `session=${token}`;
}

function envFor(d1, overrides = {}) {
  return {
    DB: d1,
    JWT_SECRET,
    APP_URL: 'https://example.test',
    PAYMENT_MOCK_ENABLED: 'true',
    ...overrides,
  };
}

function jsonRequest(url, body, cookie) {
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function getPurchase(d1, platform, externalId) {
  return d1
    .prepare('SELECT * FROM credit_purchases WHERE platform = ? AND external_id = ?')
    .bind(platform, externalId)
    .get();
}

async function getQuota(d1, userId) {
  return d1
    .prepare('SELECT * FROM user_quotas WHERE user_id = ? AND project_id = ?')
    .bind(userId, 'clearcut')
    .get();
}

test('mock checkout session creates pending Stripe credit purchase', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    const response = await createCheckoutSessionHandler({
      request: jsonRequest(
        'https://example.test/api/credit-purchases/checkout-sessions',
        { platform: 'stripe', packId: '50' },
        await authCookie(user),
      ),
      env: envFor(d1),
    });
    const body = await response.json();
    const purchase = await getPurchase(d1, 'stripe', body.sessionId);

    assert.equal(response.status, 201);
    assert.equal(body.success, true);
    assert.equal(body.platform, 'stripe');
    assert.equal(body.mock, true);
    assert.match(body.checkoutUrl, /^https:\/\/example\.test\/pricing\?/);
    assert.equal(purchase.status, 'pending');
    assert.equal(purchase.user_id, user.id);
    assert.equal(purchase.credits_amount, 50);
    assert.equal(purchase.price_paid_cents, 499);
  } finally {
    d1.close();
  }
});

test('mock checkout session requires login', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const response = await createCheckoutSessionHandler({
      request: jsonRequest(
        'https://example.test/api/credit-purchases/checkout-sessions',
        { platform: 'stripe', packId: '50' },
      ),
      env: envFor(d1),
    });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.code, 'LOGIN_REQUIRED');
  } finally {
    d1.close();
  }
});

test('mock checkout session requires database binding', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    const response = await createCheckoutSessionHandler({
      request: jsonRequest(
        'https://example.test/api/credit-purchases/checkout-sessions',
        { platform: 'stripe', packId: '50' },
        await authCookie(user),
      ),
      env: envFor(undefined),
    });
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(body.error, 'Database not configured');
  } finally {
    d1.close();
  }
});

test('mock checkout session rejects PayPal because it has a real route', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    const response = await createCheckoutSessionHandler({
      request: jsonRequest(
        'https://example.test/api/credit-purchases/checkout-sessions',
        { platform: 'paypal', packId: '50' },
        await authCookie(user),
      ),
      env: envFor(d1),
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error, 'Unsupported checkout platform');
  } finally {
    d1.close();
  }
});

test('Creem checkout cannot fall back to mock payments', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    const response = await createCheckoutSessionHandler({
      request: jsonRequest(
        'https://example.test/api/credit-purchases/checkout-sessions',
        { platform: 'creem', packId: '50' },
        await authCookie(user),
      ),
      env: envFor(d1),
    });
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.error, 'Creem payment is not configured');
  } finally {
    d1.close();
  }
});

test('mock checkout session validates pack id', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    const response = await createCheckoutSessionHandler({
      request: jsonRequest(
        'https://example.test/api/credit-purchases/checkout-sessions',
        { platform: 'stripe', packId: 'missing' },
        await authCookie(user),
      ),
      env: envFor(d1),
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error, 'Invalid pack ID');
  } finally {
    d1.close();
  }
});

test('mock checkout confirmation applies Stripe credits exactly once', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    const createResponse = await createCheckoutSessionHandler({
      request: jsonRequest(
        'https://example.test/api/credit-purchases/checkout-sessions',
        { platform: 'stripe', packId: '200' },
        await authCookie(user),
      ),
      env: envFor(d1),
    });
    const createBody = await createResponse.json();

    const first = await confirmCheckoutSessionHandler({
      request: jsonRequest(
        `https://example.test/api/credit-purchases/checkout-sessions/${createBody.sessionId}/confirm`,
        { platform: 'stripe' },
        await authCookie(user),
      ),
      env: envFor(d1),
      params: { sessionId: createBody.sessionId },
    });
    const second = await confirmCheckoutSessionHandler({
      request: jsonRequest(
        `https://example.test/api/credit-purchases/checkout-sessions/${createBody.sessionId}/confirm`,
        { platform: 'stripe' },
        await authCookie(user),
      ),
      env: envFor(d1),
      params: { sessionId: createBody.sessionId },
    });

    const firstBody = await first.json();
    const secondBody = await second.json();
    const purchase = await getPurchase(d1, 'stripe', createBody.sessionId);
    const quota = await getQuota(d1, user.id);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(firstBody.credits, 200);
    assert.equal(secondBody.credits, 200);
    assert.equal(purchase.status, 'completed');
    assert.equal(quota.credits_purchased, 200);
    assert.equal(quota.total_purchased, 200);
  } finally {
    d1.close();
  }
});

test('mock checkout confirmation validates request and ownership', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const owner = await createUser(d1, 'owner@example.com');
    const attacker = await createUser(d1, 'attacker@example.com');
    await createPendingCreditPurchase(d1, {
      userId: owner.id,
      projectId: 'clearcut',
      packageName: '50 Credits',
      credits: 50,
      pricePaidCents: 499,
      platform: 'stripe',
      externalId: 'cs_mock_owned',
    });

    const missingLogin = await confirmCheckoutSessionHandler({
      request: jsonRequest(
        'https://example.test/api/credit-purchases/checkout-sessions/cs_mock_owned/confirm',
        { platform: 'stripe' },
      ),
      env: envFor(d1),
      params: { sessionId: 'cs_mock_owned' },
    });
    const missingDb = await confirmCheckoutSessionHandler({
      request: jsonRequest(
        'https://example.test/api/credit-purchases/checkout-sessions/cs_mock_owned/confirm',
        { platform: 'stripe' },
        await authCookie(owner),
      ),
      env: envFor(undefined),
      params: { sessionId: 'cs_mock_owned' },
    });
    const missingSession = await confirmCheckoutSessionHandler({
      request: jsonRequest(
        'https://example.test/api/credit-purchases/checkout-sessions/missing/confirm',
        { platform: 'stripe' },
        await authCookie(owner),
      ),
      env: envFor(d1),
      params: {},
    });
    const unsupported = await confirmCheckoutSessionHandler({
      request: jsonRequest(
        'https://example.test/api/credit-purchases/checkout-sessions/cs_mock_owned/confirm',
        { platform: 'paypal' },
        await authCookie(owner),
      ),
      env: envFor(d1),
      params: { sessionId: 'cs_mock_owned' },
    });
    const disabled = await confirmCheckoutSessionHandler({
      request: jsonRequest(
        'https://example.test/api/credit-purchases/checkout-sessions/cs_mock_owned/confirm',
        { platform: 'stripe' },
        await authCookie(owner),
      ),
      env: envFor(d1, { PAYMENT_MOCK_ENABLED: 'false' }),
      params: { sessionId: 'cs_mock_owned' },
    });
    const unknown = await confirmCheckoutSessionHandler({
      request: jsonRequest(
        'https://example.test/api/credit-purchases/checkout-sessions/cs_mock_unknown/confirm',
        { platform: 'stripe' },
        await authCookie(owner),
      ),
      env: envFor(d1),
      params: { sessionId: 'cs_mock_unknown' },
    });
    const wrongOwner = await confirmCheckoutSessionHandler({
      request: jsonRequest(
        'https://example.test/api/credit-purchases/checkout-sessions/cs_mock_owned/confirm',
        { platform: 'stripe' },
        await authCookie(attacker),
      ),
      env: envFor(d1),
      params: { sessionId: 'cs_mock_owned' },
    });

    assert.equal(missingLogin.status, 401);
    assert.equal(missingDb.status, 500);
    assert.equal(missingSession.status, 400);
    assert.equal(unsupported.status, 400);
    assert.equal(disabled.status, 503);
    assert.equal(unknown.status, 404);
    assert.equal(wrongOwner.status, 403);
  } finally {
    d1.close();
  }
});

test('mock subscription activates Stripe plan by price external id', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    const response = await subscriptionHandler({
      request: jsonRequest(
        'https://example.test/api/subscriptions',
        {
          platform: 'stripe',
          externalId: 'sub_mock_123',
          priceExternalId: 'price_mock_pro_monthly',
        },
        await authCookie(user),
      ),
      env: envFor(d1),
    });
    const body = await response.json();
    const quota = await getQuota(d1, user.id);

    assert.equal(response.status, 201);
    assert.equal(body.success, true);
    assert.equal(body.platform, 'stripe');
    assert.equal(body.mock, true);
    assert.equal(body.plan, 'pro');
    assert.equal(quota.plan_id, 'pro');
    assert.equal(quota.credits_monthly, 300);
    assert.equal(quota.period_used, 0);
  } finally {
    d1.close();
  }
});

test('subscription endpoint validates common mock errors', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    const cookie = await authCookie(user);

    const missingLogin = await subscriptionHandler({
      request: jsonRequest(
        'https://example.test/api/subscriptions',
        { platform: 'stripe', externalId: 'sub_mock_1', priceExternalId: 'price_mock_pro_monthly' },
      ),
      env: envFor(d1),
    });
    const unsupported = await subscriptionHandler({
      request: jsonRequest(
        'https://example.test/api/subscriptions',
        { platform: 'square', externalId: 'sub_mock_1' },
        cookie,
      ),
      env: envFor(d1),
    });
    const missingExternal = await subscriptionHandler({
      request: jsonRequest(
        'https://example.test/api/subscriptions',
        { platform: 'stripe', priceExternalId: 'price_mock_pro_monthly' },
        cookie,
      ),
      env: envFor(d1),
    });
    const missingDb = await subscriptionHandler({
      request: jsonRequest(
        'https://example.test/api/subscriptions',
        { platform: 'stripe', externalId: 'sub_mock_1', priceExternalId: 'price_mock_pro_monthly' },
        cookie,
      ),
      env: envFor(undefined),
    });
    const disabled = await subscriptionHandler({
      request: jsonRequest(
        'https://example.test/api/subscriptions',
        { platform: 'stripe', externalId: 'sub_mock_1', priceExternalId: 'price_mock_pro_monthly' },
        cookie,
      ),
      env: envFor(d1, { PAYMENT_MOCK_ENABLED: 'false' }),
    });
    const unknownPlan = await subscriptionHandler({
      request: jsonRequest(
        'https://example.test/api/subscriptions',
        { platform: 'stripe', externalId: 'sub_mock_1', priceExternalId: 'price_missing' },
        cookie,
      ),
      env: envFor(d1),
    });

    assert.equal(missingLogin.status, 401);
    assert.equal(unsupported.status, 400);
    assert.equal(missingExternal.status, 400);
    assert.equal(missingDb.status, 500);
    assert.equal(disabled.status, 503);
    assert.equal(unknownPlan.status, 400);
  } finally {
    d1.close();
  }
});

test('mock subscription requires price external id', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    const response = await subscriptionHandler({
      request: jsonRequest(
        'https://example.test/api/subscriptions',
        { platform: 'stripe', externalId: 'sub_mock_missing_price' },
        await authCookie(user),
      ),
      env: envFor(d1),
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error, 'Plan price external ID required');
  } finally {
    d1.close();
  }
});

test('mock subscription rejects second active subscription with different external id', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    const cookie = await authCookie(user);
    await subscriptionHandler({
      request: jsonRequest(
        'https://example.test/api/subscriptions',
        {
          platform: 'stripe',
          externalId: 'sub_mock_first',
          priceExternalId: 'price_mock_pro_monthly',
        },
        cookie,
      ),
      env: envFor(d1),
    });

    const response = await subscriptionHandler({
      request: jsonRequest(
        'https://example.test/api/subscriptions',
        {
          platform: 'stripe',
          externalId: 'sub_mock_second',
          priceExternalId: 'price_mock_business_monthly',
        },
        cookie,
      ),
      env: envFor(d1),
    });
    const body = await response.json();

    assert.equal(response.status, 409);
    assert.equal(body.code, 'ALREADY_SUBSCRIBED');
  } finally {
    d1.close();
  }
});

test('PayPal subscription path still verifies remote subscription details', async () => {
  const d1 = createSchemaBackedD1();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.endsWith('/v1/oauth2/token')) {
      return Response.json({ access_token: 'access-token' });
    }
    if (href.endsWith('/v1/billing/subscriptions/SUB-ACTIVE')) {
      return Response.json({ id: 'SUB-ACTIVE', status: 'ACTIVE', plan_id: 'P-71M61162GE011714JNHEV2SI' });
    }
    if (href.endsWith('/v1/billing/subscriptions/SUB-SUSPENDED')) {
      return Response.json({ id: 'SUB-SUSPENDED', status: 'SUSPENDED', plan_id: 'P-71M61162GE011714JNHEV2SI' });
    }
    return new Response('Not mocked', { status: 500 });
  };

  try {
    const activeUser = await createUser(d1, 'paypal-active@example.com');
    const inactiveUser = await createUser(d1, 'paypal-inactive@example.com');
    const active = await subscriptionHandler({
      request: jsonRequest(
        'https://example.test/api/subscriptions',
        { platform: 'paypal', externalId: 'SUB-ACTIVE' },
        await authCookie(activeUser),
      ),
      env: envFor(d1, {
        PAYPAL_CLIENT_ID: 'client',
        PAYPAL_CLIENT_SECRET: 'secret',
        PAYPAL_API_BASE: 'https://paypal.test',
      }),
    });
    const inactive = await subscriptionHandler({
      request: jsonRequest(
        'https://example.test/api/subscriptions',
        { platform: 'paypal', externalId: 'SUB-SUSPENDED' },
        await authCookie(inactiveUser),
      ),
      env: envFor(d1, {
        PAYPAL_CLIENT_ID: 'client',
        PAYPAL_CLIENT_SECRET: 'secret',
        PAYPAL_API_BASE: 'https://paypal.test',
      }),
    });

    const activeBody = await active.json();
    const inactiveBody = await inactive.json();

    assert.equal(active.status, 201);
    assert.equal(activeBody.mock, false);
    assert.equal(activeBody.plan, 'pro');
    assert.equal(activeBody.status, 'ACTIVE');
    assert.equal(inactive.status, 400);
    assert.equal(inactiveBody.status, 'SUSPENDED');
  } finally {
    globalThis.fetch = originalFetch;
    d1.close();
  }
});
