import test from 'node:test';
import assert from 'node:assert/strict';
import { signJWT } from '../foundation/modules/auth/index.js';
import { createPendingCreditPurchase } from '../foundation/modules/payments/index.js';
import { onRequestPost as createCheckoutSessionHandler } from '../functions/api/credit-purchases/checkout-sessions.js';
import { onRequestPost as createSubscriptionCheckoutHandler } from '../functions/api/subscription-checkout-sessions.js';
import { onRequestPost as creemWebhookHandler } from '../functions/api/webhooks/creem.js';
import { createSchemaBackedD1 } from './d1-test-db.mjs';

const JWT_SECRET = 'test-secret';
const CREEM_WEBHOOK_SECRET = 'webhook-secret';

async function createUser(d1, email = 'creem-buyer@example.com') {
  await d1.prepare('INSERT INTO users (email, name) VALUES (?, ?)').bind(email, 'Creem Buyer').run();
  return d1.prepare('SELECT id, email FROM users WHERE email = ?').bind(email).get();
}

async function authCookie(user) {
  const token = await signJWT({ sub: String(user.id), email: user.email, name: 'Creem Buyer' }, JWT_SECRET);
  return `session=${token}`;
}

function envFor(d1, overrides = {}) {
  return {
    DB: d1,
    JWT_SECRET,
    APP_URL: 'https://example.test',
    CREEM_API_KEY: 'creem-test-key',
    CREEM_API_BASE: 'https://creem.test',
    CREEM_WEBHOOK_SECRET,
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

async function hmacSha256Hex(secret, payload) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function signedWebhookRequest(body, secret = CREEM_WEBHOOK_SECRET) {
  const rawBody = JSON.stringify(body);
  return new Request('https://example.test/api/webhooks/creem', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'creem-signature': await hmacSha256Hex(secret, rawBody),
    },
    body: rawBody,
  });
}

async function getPurchase(d1, externalId) {
  return d1
    .prepare('SELECT * FROM credit_purchases WHERE platform = ? AND external_id = ?')
    .bind('creem', externalId)
    .get();
}

async function getQuota(d1, userId) {
  return d1
    .prepare('SELECT * FROM user_quotas WHERE user_id = ? AND project_id = ?')
    .bind(userId, 'clearcut')
    .get();
}

function installCreemCheckoutFetchMock({ sessionId = 'ch_creem_1', url = 'https://checkout.creem.io/ch_creem_1' } = {}) {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (requestUrl, init) => {
    calls.push({ url: String(requestUrl), init });
    if (String(requestUrl).endsWith('/v1/checkouts') && init?.method === 'POST') {
      return Response.json({
        id: sessionId,
        checkout_url: url,
        status: 'pending',
      });
    }
    return new Response('Not mocked', { status: 500 });
  };

  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

test('Creem credit checkout creates real checkout and pending purchase', async () => {
  const d1 = createSchemaBackedD1();
  const fetchMock = installCreemCheckoutFetchMock({ sessionId: 'ch_credit_1' });
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
    const purchase = await getPurchase(d1, 'ch_credit_1');
    const payload = JSON.parse(fetchMock.calls[0].init.body);

    assert.equal(response.status, 201);
    assert.equal(body.success, true);
    assert.equal(body.mock, false);
    assert.equal(body.checkoutUrl, 'https://checkout.creem.io/ch_creem_1');
    assert.equal(payload.product_id, 'creem_mock_50_credits');
    assert.equal(payload.customer.email, user.email);
    assert.equal(payload.metadata.kind, 'credit_purchase');
    assert.equal(purchase.status, 'pending');
    assert.equal(purchase.price_paid_cents, 499);
  } finally {
    fetchMock.restore();
    d1.close();
  }
});

test('Creem credit checkout validates missing configuration and malformed API response', async () => {
  const d1 = createSchemaBackedD1();
  const originalFetch = globalThis.fetch;
  try {
    const user = await createUser(d1);
    const cookie = await authCookie(user);

    const notConfigured = await createCheckoutSessionHandler({
      request: jsonRequest(
        'https://example.test/api/credit-purchases/checkout-sessions',
        { platform: 'creem', packId: '50' },
        cookie,
      ),
      env: envFor(d1, { CREEM_API_KEY: '', PAYMENT_MOCK_ENABLED: 'false' }),
    });

    await d1
      .prepare('UPDATE credit_packages SET external_id = NULL WHERE project_id = ? AND platform = ? AND package_id = ?')
      .bind('clearcut', 'creem', '50')
      .run();
    const missingProduct = await createCheckoutSessionHandler({
      request: jsonRequest(
        'https://example.test/api/credit-purchases/checkout-sessions',
        { platform: 'creem', packId: '50' },
        cookie,
      ),
      env: envFor(d1),
    });

    await d1
      .prepare('UPDATE credit_packages SET external_id = ? WHERE project_id = ? AND platform = ? AND package_id = ?')
      .bind('creem_mock_50_credits', 'clearcut', 'creem', '50')
      .run();
    globalThis.fetch = async () => Response.json({ checkout_url: 'https://checkout.creem.io/missing-id' });
    const missingSession = await createCheckoutSessionHandler({
      request: jsonRequest(
        'https://example.test/api/credit-purchases/checkout-sessions',
        { platform: 'creem', packId: '50' },
        cookie,
      ),
      env: envFor(d1),
    });

    assert.equal(notConfigured.status, 503);
    assert.equal((await notConfigured.json()).error, 'creem payment is not configured');
    assert.equal(missingProduct.status, 400);
    assert.equal((await missingProduct.json()).error, 'Creem product ID not configured');
    assert.equal(missingSession.status, 502);
    assert.equal((await missingSession.json()).error, 'Checkout session ID missing');
  } finally {
    globalThis.fetch = originalFetch;
    d1.close();
  }
});

test('Creem subscription checkout creates hosted checkout session', async () => {
  const d1 = createSchemaBackedD1();
  const fetchMock = installCreemCheckoutFetchMock({ sessionId: 'ch_sub_1' });
  try {
    const user = await createUser(d1);
    const response = await createSubscriptionCheckoutHandler({
      request: jsonRequest(
        'https://example.test/api/subscription-checkout-sessions',
        { platform: 'creem', priceExternalId: 'creem_mock_pro_monthly' },
        await authCookie(user),
      ),
      env: envFor(d1),
    });
    const body = await response.json();
    const payload = JSON.parse(fetchMock.calls[0].init.body);

    assert.equal(response.status, 201);
    assert.equal(body.success, true);
    assert.equal(body.mock, false);
    assert.equal(body.sessionId, 'ch_sub_1');
    assert.equal(payload.product_id, 'creem_mock_pro_monthly');
    assert.equal(payload.metadata.kind, 'subscription');
    assert.equal(payload.metadata.planId, 'pro');
  } finally {
    fetchMock.restore();
    d1.close();
  }
});

test('subscription checkout endpoint validates request branches', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    const cookie = await authCookie(user);

    const missingLogin = await createSubscriptionCheckoutHandler({
      request: jsonRequest(
        'https://example.test/api/subscription-checkout-sessions',
        { platform: 'creem', priceExternalId: 'creem_mock_pro_monthly' },
      ),
      env: envFor(d1),
    });
    const missingDb = await createSubscriptionCheckoutHandler({
      request: jsonRequest(
        'https://example.test/api/subscription-checkout-sessions',
        { platform: 'creem', priceExternalId: 'creem_mock_pro_monthly' },
        cookie,
      ),
      env: envFor(undefined),
    });
    const unsupported = await createSubscriptionCheckoutHandler({
      request: jsonRequest(
        'https://example.test/api/subscription-checkout-sessions',
        { platform: 'paypal', priceExternalId: 'P-1' },
        cookie,
      ),
      env: envFor(d1),
    });
    const missingPrice = await createSubscriptionCheckoutHandler({
      request: jsonRequest(
        'https://example.test/api/subscription-checkout-sessions',
        { platform: 'creem' },
        cookie,
      ),
      env: envFor(d1),
    });
    const unknownPlan = await createSubscriptionCheckoutHandler({
      request: jsonRequest(
        'https://example.test/api/subscription-checkout-sessions',
        { platform: 'creem', priceExternalId: 'creem_missing' },
        cookie,
      ),
      env: envFor(d1),
    });
    const stripeDisabled = await createSubscriptionCheckoutHandler({
      request: jsonRequest(
        'https://example.test/api/subscription-checkout-sessions',
        { platform: 'stripe', priceExternalId: 'price_mock_pro_monthly' },
        cookie,
      ),
      env: envFor(d1, { PAYMENT_MOCK_ENABLED: 'false' }),
    });

    assert.equal(missingLogin.status, 401);
    assert.equal(missingDb.status, 500);
    assert.equal(unsupported.status, 400);
    assert.equal(missingPrice.status, 400);
    assert.equal(unknownPlan.status, 400);
    assert.equal(stripeDisabled.status, 503);
  } finally {
    d1.close();
  }
});

test('subscription checkout supports Stripe mock and rejects active subscription', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    const cookie = await authCookie(user);
    const stripe = await createSubscriptionCheckoutHandler({
      request: jsonRequest(
        'https://example.test/api/subscription-checkout-sessions',
        { platform: 'stripe', priceExternalId: 'price_mock_pro_monthly' },
        cookie,
      ),
      env: envFor(d1, { CREEM_API_KEY: '', PAYMENT_MOCK_ENABLED: 'true' }),
    });
    await d1.prepare(`
      INSERT INTO subscriptions (user_id, project_id, plan_id, platform, external_id, status)
      VALUES (?, 'clearcut', 'pro', 'creem', 'sub_existing', 'active')
    `).bind(user.id).run();
    const activeExists = await createSubscriptionCheckoutHandler({
      request: jsonRequest(
        'https://example.test/api/subscription-checkout-sessions',
        { platform: 'creem', priceExternalId: 'creem_mock_pro_monthly' },
        cookie,
      ),
      env: envFor(d1),
    });
    const stripeBody = await stripe.json();
    const activeBody = await activeExists.json();

    assert.equal(stripe.status, 201);
    assert.equal(stripeBody.mock, true);
    assert.match(stripeBody.checkoutUrl, /^https:\/\/example\.test\/pricing\?/);
    assert.equal(activeExists.status, 409);
    assert.equal(activeBody.code, 'ALREADY_SUBSCRIBED');
  } finally {
    d1.close();
  }
});

test('Creem webhook completes credit purchase from checkout.completed', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    await createPendingCreditPurchase(d1, {
      userId: user.id,
      projectId: 'clearcut',
      packageName: '50 Credits',
      credits: 50,
      pricePaidCents: 499,
      platform: 'creem',
      externalId: 'ch_credit_paid',
    });

    const response = await creemWebhookHandler({
      request: await signedWebhookRequest({
        id: 'evt_credit_paid',
        eventType: 'checkout.completed',
        object: {
          id: 'ch_credit_paid',
          object: 'checkout',
          metadata: { kind: 'credit_purchase' },
          order: { id: 'ord_credit_paid' },
          product: { id: 'creem_mock_50_credits' },
        },
      }),
      env: envFor(d1),
    });
    const body = await response.json();
    const purchase = await getPurchase(d1, 'ch_credit_paid');
    const quota = await getQuota(d1, user.id);
    const event = await d1.prepare('SELECT status FROM payment_events WHERE external_id = ?').bind('evt_credit_paid').get();

    assert.equal(response.status, 200);
    assert.equal(body.received, true);
    assert.equal(purchase.status, 'completed');
    assert.equal(quota.credits_purchased, 50);
    assert.equal(quota.total_purchased, 50);
    assert.equal(event.status, 'processed');
  } finally {
    d1.close();
  }
});

test('Creem webhook activates subscription from checkout.completed', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    const response = await creemWebhookHandler({
      request: await signedWebhookRequest({
        id: 'evt_subscription_paid',
        eventType: 'checkout.completed',
        object: {
          id: 'ch_subscription_paid',
          object: 'checkout',
          metadata: {
            kind: 'subscription',
            userId: String(user.id),
            priceExternalId: 'creem_mock_pro_monthly',
          },
          subscription: { id: 'sub_creem_1' },
          product: { id: 'creem_mock_pro_monthly' },
        },
      }),
      env: envFor(d1),
    });
    const body = await response.json();
    const quota = await getQuota(d1, user.id);
    const subscription = await d1
      .prepare('SELECT * FROM subscriptions WHERE platform = ? AND external_id = ?')
      .bind('creem', 'sub_creem_1')
      .get();

    assert.equal(response.status, 200);
    assert.equal(body.received, true);
    assert.equal(subscription.status, 'active');
    assert.equal(subscription.plan_id, 'pro');
    assert.equal(quota.plan_id, 'pro');
    assert.equal(quota.credits_monthly, 300);
  } finally {
    d1.close();
  }
});

test('Creem webhook handles duplicate, grant, revoke, and ignored events', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    const grantBody = {
      id: 'evt_subscription_active',
      eventType: 'subscription.active',
      object: {
        id: 'sub_creem_active',
        object: 'subscription',
        metadata: {
          userId: String(user.id),
          priceExternalId: 'creem_mock_business_monthly',
        },
        product: { id: 'creem_mock_business_monthly' },
      },
    };

    const grant = await creemWebhookHandler({
      request: await signedWebhookRequest(grantBody),
      env: envFor(d1),
    });
    const duplicate = await creemWebhookHandler({
      request: await signedWebhookRequest(grantBody),
      env: envFor(d1),
    });
    const canceled = await creemWebhookHandler({
      request: await signedWebhookRequest({
        id: 'evt_subscription_canceled',
        eventType: 'subscription.canceled',
        object: {
          id: 'sub_creem_active',
          metadata: { userId: String(user.id) },
        },
      }),
      env: envFor(d1),
    });
    const expired = await creemWebhookHandler({
      request: await signedWebhookRequest({
        id: 'evt_subscription_expired',
        eventType: 'subscription.expired',
        object: {
          id: 'sub_creem_active',
          metadata: { userId: String(user.id) },
        },
      }),
      env: envFor(d1),
    });
    const paused = await creemWebhookHandler({
      request: await signedWebhookRequest({
        id: 'evt_subscription_paused',
        eventType: 'subscription.paused',
        object: {
          id: 'sub_creem_active',
          metadata: { userId: String(user.id) },
        },
      }),
      env: envFor(d1),
    });
    const ignored = await creemWebhookHandler({
      request: await signedWebhookRequest({
        id: 'evt_unknown',
        eventType: 'customer.created',
        object: { id: 'cust_1', object: 'customer' },
      }),
      env: envFor(d1),
    });
    const quota = await getQuota(d1, user.id);
    const ignoredEvent = await d1.prepare('SELECT status FROM payment_events WHERE external_id = ?').bind('evt_unknown').get();

    assert.equal(grant.status, 200);
    assert.equal((await duplicate.json()).duplicate, true);
    assert.equal(canceled.status, 200);
    assert.equal(expired.status, 200);
    assert.equal(paused.status, 200);
    assert.equal(ignored.status, 200);
    assert.equal(quota.credits_monthly, 0);
    assert.equal(ignoredEvent.status, 'ignored');
  } finally {
    d1.close();
  }
});

test('Creem webhook covers ignored checkout and subscription edge cases', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const noCheckoutId = await creemWebhookHandler({
      request: await signedWebhookRequest({
        id: 'evt_no_checkout_id',
        eventType: 'checkout.completed',
        object: {
          object: 'checkout',
          checkout_id: '',
          metadata: { kind: 'credit_purchase' },
        },
      }),
      env: envFor(d1),
    });
    const unknownPurchase = await creemWebhookHandler({
      request: await signedWebhookRequest({
        id: 'evt_unknown_purchase',
        eventType: 'checkout.completed',
        object: {
          checkout_id: 'ch_missing',
          object: 'checkout',
          metadata: { kind: 'credit_purchase' },
          order_id: 'ord_missing',
          product_id: 'creem_mock_50_credits',
        },
      }),
      env: envFor(d1),
    });
    const unsupportedKind = await creemWebhookHandler({
      request: await signedWebhookRequest({
        id: 'evt_unsupported_kind',
        eventType: 'checkout.completed',
        object: {
          id: 'ch_other',
          object: 'checkout',
          metadata: { kind: 'license_key' },
        },
      }),
      env: envFor(d1),
    });
    const subscriptionMissingFields = await creemWebhookHandler({
      request: await signedWebhookRequest({
        id: 'evt_subscription_missing_fields',
        eventType: 'checkout.completed',
        object: {
          id: 'ch_sub_missing',
          object: 'checkout',
          metadata: { kind: 'subscription' },
          subscription_id: 'sub_missing_fields',
        },
      }),
      env: envFor(d1),
    });
    const subscriptionUnknownPlan = await creemWebhookHandler({
      request: await signedWebhookRequest({
        id: 'evt_subscription_unknown_plan',
        eventType: 'checkout.completed',
        object: {
          id: 'ch_sub_unknown_plan',
          object: 'checkout',
          metadata: {
            kind: 'subscription',
            userId: '1',
            priceExternalId: 'creem_unknown_plan',
          },
          subscription_id: 'sub_unknown_plan',
        },
      }),
      env: envFor(d1),
    });
    const grantMissingFields = await creemWebhookHandler({
      request: await signedWebhookRequest({
        id: 'evt_grant_missing_fields',
        eventType: 'subscription.paid',
        object: {
          id: 'sub_grant_missing',
          object: 'subscription',
          metadata: {},
        },
      }),
      env: envFor(d1),
    });
    const grantUnknownPlan = await creemWebhookHandler({
      request: await signedWebhookRequest({
        id: 'evt_grant_unknown_plan',
        eventType: 'subscription.trialing',
        object: {
          id: 'sub_grant_unknown',
          object: 'subscription',
          metadata: {
            userId: '1',
            priceExternalId: 'creem_unknown_plan',
          },
        },
      }),
      env: envFor(d1),
    });
    const revokeIgnored = await creemWebhookHandler({
      request: await signedWebhookRequest({
        id: 'evt_revoke_ignored',
        eventType: 'subscription.expired',
        object: {
          object: 'subscription',
          metadata: {},
        },
      }),
      env: envFor(d1),
    });

    for (const response of [
      noCheckoutId,
      unknownPurchase,
      unsupportedKind,
      subscriptionMissingFields,
      subscriptionUnknownPlan,
      grantMissingFields,
      grantUnknownPlan,
      revokeIgnored,
    ]) {
      assert.equal(response.status, 200);
    }

    const statuses = await d1.prepare(`
      SELECT external_id, status
      FROM payment_events
      WHERE external_id IN (
        'evt_no_checkout_id',
        'evt_unknown_purchase',
        'evt_unsupported_kind',
        'evt_subscription_missing_fields',
        'evt_subscription_unknown_plan',
        'evt_grant_missing_fields',
        'evt_grant_unknown_plan',
        'evt_revoke_ignored'
      )
    `).all();

    assert.deepEqual(
      statuses.results.map((row) => row.status),
      ['ignored', 'ignored', 'ignored', 'ignored', 'ignored', 'ignored', 'ignored', 'ignored'],
    );
  } finally {
    d1.close();
  }
});

test('Creem webhook accepts alternate type/data payload shape', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const response = await creemWebhookHandler({
      request: await signedWebhookRequest({
        type: 'customer.created',
        data: {
          id: 'cust_alt_shape',
          object: 'customer',
        },
      }),
      env: envFor(d1),
    });
    const body = await response.json();
    const event = await d1
      .prepare('SELECT event_type, resource_id, status FROM payment_events WHERE event_type = ?')
      .bind('customer.created')
      .get();

    assert.equal(response.status, 200);
    assert.equal(body.received, true);
    assert.equal(event.resource_id, 'cust_alt_shape');
    assert.equal(event.status, 'ignored');
  } finally {
    d1.close();
  }
});

test('Creem webhook validates database binding and unsigned development mode', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const missingDb = await creemWebhookHandler({
      request: await signedWebhookRequest({ id: 'evt_no_db', eventType: 'checkout.completed', object: {} }),
      env: envFor(undefined),
    });
    const unsigned = await creemWebhookHandler({
      request: new Request('https://example.test/api/webhooks/creem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'evt_unsigned', eventType: 'customer.created', object: { id: 'cust_1' } }),
      }),
      env: envFor(d1, { CREEM_WEBHOOK_SECRET: '' }),
    });
    const badJson = await creemWebhookHandler({
      request: new Request('https://example.test/api/webhooks/creem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      }),
      env: envFor(d1, { CREEM_WEBHOOK_SECRET: '' }),
    });

    assert.equal(missingDb.status, 500);
    assert.equal(unsigned.status, 200);
    assert.equal(badJson.status, 200);
    assert.equal((await badJson.json()).received, true);
  } finally {
    d1.close();
  }
});

test('Creem webhook rejects invalid signature', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const response = await creemWebhookHandler({
      request: await signedWebhookRequest({ id: 'evt_bad', eventType: 'checkout.completed', object: {} }, 'bad-secret'),
      env: envFor(d1),
    });

    assert.equal(response.status, 403);
  } finally {
    d1.close();
  }
});
