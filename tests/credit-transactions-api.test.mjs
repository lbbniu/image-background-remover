import test from 'node:test';
import assert from 'node:assert/strict';
import { signJWT } from '../functions/lib/auth.js';
import { onRequestGet as transactionsHandler } from '../functions/api/me/credits/transactions.js';
import { createSchemaBackedD1 } from './d1-test-db.mjs';

const JWT_SECRET = 'test-secret';

async function createUser(d1, email = 'ledger@example.com') {
  await d1.prepare('INSERT INTO users (email, name) VALUES (?, ?)').bind(email, 'Ledger User').run();
  return d1.prepare('SELECT id, email FROM users WHERE email = ?').bind(email).get();
}

async function authCookie(user) {
  const token = await signJWT({ sub: String(user.id), email: user.email, name: 'Ledger User' }, JWT_SECRET);
  return `session=${token}`;
}

function getRequest(url, cookie) {
  return new Request(url, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

function envFor(d1, projectId = 'clearcut') {
  return {
    DB: d1,
    JWT_SECRET,
    PROJECT_ID: projectId,
  };
}

async function insertTransaction(d1, {
  userId,
  projectId = 'clearcut',
  type,
  source,
  amount,
  externalId,
  metadata,
  createdAt,
}) {
  await d1.prepare(`
    INSERT INTO credit_transactions
      (user_id, project_id, type, source, amount, platform, external_id, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, 'internal', ?, ?, ?)
  `).bind(
    userId,
    projectId,
    type,
    source,
    amount,
    externalId,
    metadata ? JSON.stringify(metadata) : null,
    createdAt,
  ).run();
}

test('credit transactions endpoint requires login', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const response = await transactionsHandler({
      request: getRequest('https://example.test/api/me/credits/transactions'),
      env: envFor(d1),
    });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.code, 'LOGIN_REQUIRED');
  } finally {
    d1.close();
  }
});

test('credit transactions endpoint returns current project ledger only', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    await insertTransaction(d1, {
      userId: user.id,
      type: 'purchase',
      source: 'purchased',
      amount: 50,
      externalId: 'purchase-1',
      metadata: { packageName: '50 Credits' },
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await insertTransaction(d1, {
      userId: user.id,
      type: 'consume',
      source: 'purchased',
      amount: -2,
      externalId: 'job-1',
      metadata: { usageAction: 'background.remove' },
      createdAt: '2026-01-02T00:00:00.000Z',
    });
    await insertTransaction(d1, {
      userId: user.id,
      projectId: 'other-project',
      type: 'consume',
      source: 'purchased',
      amount: -99,
      externalId: 'other-project-job',
      createdAt: '2026-01-03T00:00:00.000Z',
    });

    const response = await transactionsHandler({
      request: getRequest(
        'https://example.test/api/me/credits/transactions?limit=10',
        await authCookie(user),
      ),
      env: envFor(d1),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.pagination.total, 2);
    assert.equal(body.pagination.hasMore, false);
    assert.deepEqual(body.items.map((item) => item.externalId), ['job-1', 'purchase-1']);
    assert.equal(body.items[0].amount, -2);
    assert.deepEqual(body.items[0].metadata, { usageAction: 'background.remove' });
  } finally {
    d1.close();
  }
});

test('credit transactions endpoint supports type filter and pagination', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    await insertTransaction(d1, {
      userId: user.id,
      type: 'gift',
      source: 'gifted',
      amount: 3,
      externalId: 'gift-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await insertTransaction(d1, {
      userId: user.id,
      type: 'consume',
      source: 'gifted',
      amount: -1,
      externalId: 'job-1',
      createdAt: '2026-01-02T00:00:00.000Z',
    });
    await insertTransaction(d1, {
      userId: user.id,
      type: 'consume',
      source: 'gifted',
      amount: -1,
      externalId: 'job-2',
      createdAt: '2026-01-03T00:00:00.000Z',
    });

    const response = await transactionsHandler({
      request: getRequest(
        'https://example.test/api/me/credits/transactions?type=consume&limit=1&offset=1',
        await authCookie(user),
      ),
      env: envFor(d1),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.pagination.total, 2);
    assert.equal(body.pagination.limit, 1);
    assert.equal(body.pagination.offset, 1);
    assert.equal(body.pagination.hasMore, false);
    assert.deepEqual(body.items.map((item) => item.externalId), ['job-1']);
  } finally {
    d1.close();
  }
});

test('credit transactions endpoint rejects invalid filters', async () => {
  const d1 = createSchemaBackedD1();
  try {
    const user = await createUser(d1);
    const response = await transactionsHandler({
      request: getRequest(
        'https://example.test/api/me/credits/transactions?type=invalid',
        await authCookie(user),
      ),
      env: envFor(d1),
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error, 'Invalid transaction type');
  } finally {
    d1.close();
  }
});

