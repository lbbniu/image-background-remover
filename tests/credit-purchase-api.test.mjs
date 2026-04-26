import test from 'node:test';
import assert from 'node:assert/strict';
import { signJWT } from '../functions/lib/auth.js';
import { createPendingCreditPurchase } from '../functions/lib/payments/credit-purchases.js';
import { onRequestPost as createOrderHandler } from '../functions/api/credit-purchases/paypal-orders.js';
import { onRequestPost as captureOrderHandler } from '../functions/api/credit-purchases/paypal-orders/[orderId]/capture.js';
import { createSchemaBackedD1 } from './d1-test-db.mjs';

const JWT_SECRET = 'test-secret';

async function createUser(d1, email = 'buyer@example.com') {
  await d1.prepare('INSERT INTO users (email, name) VALUES (?, ?)').bind(email, 'Buyer').run();
  return d1.prepare('SELECT id, email FROM users WHERE email = ?').bind(email).get();
}

async function authCookie(user) {
  const token = await signJWT({ sub: String(user.id), email: user.email, name: 'Buyer' }, JWT_SECRET);
  return `session=${token}`;
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

async function readJson(response) {
  return response.json();
}

function envFor(d1) {
  return {
    DB: d1,
    JWT_SECRET,
    PAYPAL_CLIENT_ID: 'client',
    PAYPAL_CLIENT_SECRET: 'secret',
    PAYPAL_API_BASE: 'https://paypal.test',
  };
}

function installPayPalFetchMock({ orderId = 'ORDER-1', captureStatus = 'COMPLETED', amount = '4.99' } = {}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.endsWith('/v1/oauth2/token')) {
      return Response.json({ access_token: 'access-token' });
    }
    if (href.endsWith('/v2/checkout/orders') && init?.method === 'POST') {
      return Response.json({ id: orderId, status: 'CREATED' });
    }
    if (href.endsWith(`/v2/checkout/orders/${orderId}/capture`)) {
      return Response.json({
        id: orderId,
        status: captureStatus,
        payer: { payer_id: 'PAYER-1' },
        purchase_units: [
          {
            payments: {
              captures: [
                { id: 'CAPTURE-1', amount: { currency_code: 'USD', value: amount } },
              ],
            },
          },
        ],
      });
    }
    return new Response('Not mocked', { status: 500 });
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function getPurchase(d1, externalId) {
  return d1
    .prepare('SELECT * FROM credit_purchases WHERE platform = ? AND external_id = ?')
    .bind('paypal', externalId)
    .get();
}

async function getQuota(d1, userId) {
  return d1
    .prepare('SELECT credits_purchased, total_purchased FROM user_quotas WHERE user_id = ? AND project_id = ?')
    .bind(userId, 'clearcut')
    .get();
}

test('create credit purchase order requires login', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const response = await createOrderHandler({
      request: jsonRequest('https://example.test/api/credit-purchases/paypal-orders', { packId: '50' }),
      env: envFor(d1),
    });
    const body = await readJson(response);

    assert.equal(response.status, 401);
    assert.equal(body.code, 'LOGIN_REQUIRED');
  } finally {
    d1.close();
  }
});

test('create credit purchase order validates pack id', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    const response = await createOrderHandler({
      request: jsonRequest(
        'https://example.test/api/credit-purchases/paypal-orders',
        { packId: 'invalid' },
        await authCookie(user),
      ),
      env: envFor(d1),
    });
    const body = await readJson(response);

    assert.equal(response.status, 400);
    assert.equal(body.error, 'Invalid pack ID');
  } finally {
    d1.close();
  }
});

test('create credit purchase order writes a pending local purchase', async () => {
  const d1 = createSchemaBackedD1();
  const restoreFetch = installPayPalFetchMock({ orderId: 'ORDER-CREATE' });
  try {
    const user = await createUser(d1);
    const response = await createOrderHandler({
      request: jsonRequest(
        'https://example.test/api/credit-purchases/paypal-orders',
        { packId: '50' },
        await authCookie(user),
      ),
      env: envFor(d1),
    });
    const body = await readJson(response);
    const purchase = await getPurchase(d1, 'ORDER-CREATE');

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.orderId, 'ORDER-CREATE');
    assert.equal(purchase.status, 'pending');
    assert.equal(purchase.user_id, user.id);
    assert.equal(purchase.credits_amount, 50);
    assert.equal(purchase.price_paid_cents, 499);
  } finally {
    restoreFetch();
    d1.close();
  }
});

test('capture rejects unknown orders before calling PayPal', async () => {
  const d1 = createSchemaBackedD1();
  const restoreFetch = installPayPalFetchMock({ orderId: 'ORDER-UNKNOWN' });
  try {
    const user = await createUser(d1);
    const response = await captureOrderHandler({
      request: jsonRequest(
        'https://example.test/api/credit-purchases/paypal-orders/ORDER-UNKNOWN/capture',
        {},
        await authCookie(user),
      ),
      env: envFor(d1),
      params: { orderId: 'ORDER-UNKNOWN' },
    });
    const body = await readJson(response);

    assert.equal(response.status, 404);
    assert.equal(body.error, 'Unknown order');
  } finally {
    restoreFetch();
    d1.close();
  }
});

test('capture requires login', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const response = await captureOrderHandler({
      request: jsonRequest(
        'https://example.test/api/credit-purchases/paypal-orders/ORDER-LOGIN/capture',
        {},
      ),
      env: envFor(d1),
      params: { orderId: 'ORDER-LOGIN' },
    });
    const body = await readJson(response);

    assert.equal(response.status, 401);
    assert.equal(body.code, 'LOGIN_REQUIRED');
  } finally {
    d1.close();
  }
});

test('capture requires order id', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    const response = await captureOrderHandler({
      request: jsonRequest(
        'https://example.test/api/credit-purchases/paypal-orders/missing/capture',
        {},
        await authCookie(user),
      ),
      env: envFor(d1),
      params: {},
    });
    const body = await readJson(response);

    assert.equal(response.status, 400);
    assert.equal(body.error, 'Order ID required');
  } finally {
    d1.close();
  }
});

test('capture rejects orders owned by another user', async () => {
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
      platform: 'paypal',
      externalId: 'ORDER-OWNED',
    });

    const response = await captureOrderHandler({
      request: jsonRequest(
        'https://example.test/api/credit-purchases/paypal-orders/ORDER-OWNED/capture',
        {},
        await authCookie(attacker),
      ),
      env: envFor(d1),
      params: { orderId: 'ORDER-OWNED' },
    });
    const body = await readJson(response);

    assert.equal(response.status, 403);
    assert.equal(body.error, 'Order does not belong to current user');
  } finally {
    d1.close();
  }
});

test('capture applies credits when PayPal returns completed with matching amount', async () => {
  const d1 = createSchemaBackedD1();
  const restoreFetch = installPayPalFetchMock({ orderId: 'ORDER-CAPTURE', amount: '14.99' });
  try {
    const user = await createUser(d1);
    await createPendingCreditPurchase(d1, {
      userId: user.id,
      projectId: 'clearcut',
      packageName: '200 Credits',
      credits: 200,
      pricePaidCents: 1499,
      platform: 'paypal',
      externalId: 'ORDER-CAPTURE',
    });

    const response = await captureOrderHandler({
      request: jsonRequest(
        'https://example.test/api/credit-purchases/paypal-orders/ORDER-CAPTURE/capture',
        {},
        await authCookie(user),
      ),
      env: envFor(d1),
      params: { orderId: 'ORDER-CAPTURE' },
    });
    const body = await readJson(response);
    const purchase = await getPurchase(d1, 'ORDER-CAPTURE');
    const quota = await getQuota(d1, user.id);

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.credits, 200);
    assert.equal(purchase.status, 'completed');
    assert.equal(quota.credits_purchased, 200);
    assert.equal(quota.total_purchased, 200);
  } finally {
    restoreFetch();
    d1.close();
  }
});

test('capture rejects amount mismatch without applying credits', async () => {
  const d1 = createSchemaBackedD1();
  const restoreFetch = installPayPalFetchMock({ orderId: 'ORDER-BAD-AMOUNT', amount: '4.99' });
  try {
    const user = await createUser(d1);
    await createPendingCreditPurchase(d1, {
      userId: user.id,
      projectId: 'clearcut',
      packageName: '200 Credits',
      credits: 200,
      pricePaidCents: 1499,
      platform: 'paypal',
      externalId: 'ORDER-BAD-AMOUNT',
    });

    const response = await captureOrderHandler({
      request: jsonRequest(
        'https://example.test/api/credit-purchases/paypal-orders/ORDER-BAD-AMOUNT/capture',
        {},
        await authCookie(user),
      ),
      env: envFor(d1),
      params: { orderId: 'ORDER-BAD-AMOUNT' },
    });
    const body = await readJson(response);
    const purchase = await getPurchase(d1, 'ORDER-BAD-AMOUNT');
    const quota = await getQuota(d1, user.id);

    assert.equal(response.status, 400);
    assert.equal(body.error, 'Amount mismatch');
    assert.equal(purchase.status, 'pending');
    assert.equal(quota.credits_purchased, 0);
  } finally {
    restoreFetch();
    d1.close();
  }
});

test('capture returns completed purchase idempotently without calling PayPal again', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    await createPendingCreditPurchase(d1, {
      userId: user.id,
      projectId: 'clearcut',
      packageName: '50 Credits',
      credits: 50,
      pricePaidCents: 499,
      platform: 'paypal',
      externalId: 'ORDER-DONE',
    });

    await d1
      .prepare(`
        UPDATE credit_purchases
        SET status = 'completed'
        WHERE platform = 'paypal' AND external_id = 'ORDER-DONE'
      `)
      .run();

    const response = await captureOrderHandler({
      request: jsonRequest(
        'https://example.test/api/credit-purchases/paypal-orders/ORDER-DONE/capture',
        {},
        await authCookie(user),
      ),
      env: envFor(d1),
      params: { orderId: 'ORDER-DONE' },
    });
    const body = await readJson(response);

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.credits, 50);
  } finally {
    d1.close();
  }
});

test('capture rejects non-completed PayPal status', async () => {
  const d1 = createSchemaBackedD1();
  const restoreFetch = installPayPalFetchMock({ orderId: 'ORDER-PENDING-PAYPAL', captureStatus: 'PENDING' });
  try {
    const user = await createUser(d1);
    await createPendingCreditPurchase(d1, {
      userId: user.id,
      projectId: 'clearcut',
      packageName: '50 Credits',
      credits: 50,
      pricePaidCents: 499,
      platform: 'paypal',
      externalId: 'ORDER-PENDING-PAYPAL',
    });

    const response = await captureOrderHandler({
      request: jsonRequest(
        'https://example.test/api/credit-purchases/paypal-orders/ORDER-PENDING-PAYPAL/capture',
        {},
        await authCookie(user),
      ),
      env: envFor(d1),
      params: { orderId: 'ORDER-PENDING-PAYPAL' },
    });
    const body = await readJson(response);
    const quota = await getQuota(d1, user.id);

    assert.equal(response.status, 400);
    assert.equal(body.error, 'Payment not completed');
    assert.equal(body.status, 'PENDING');
    assert.equal(quota.credits_purchased, 0);
  } finally {
    restoreFetch();
    d1.close();
  }
});
