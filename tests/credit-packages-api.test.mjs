import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as packagesHandler } from '../functions/api/credit-packages.js';
import { createSchemaBackedD1 } from './d1-test-db.mjs';

function envFor(d1, projectId = 'clearcut') {
  return {
    DB: d1,
    PROJECT_ID: projectId,
  };
}

test('credit packages endpoint returns active packages for current project', async () => {
  const d1 = createSchemaBackedD1();

  try {
    const response = await packagesHandler({
      request: new Request('https://example.test/api/credit-packages?platform=paypal'),
      env: envFor(d1),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.deepEqual(body.packages.map((pack) => pack.id), ['50', '200', '500']);
    assert.equal(body.packages[1].credits, 200);
    assert.equal(body.packages[1].amountCents, 1499);
    assert.equal(body.packages[1].price, '14.99');
    assert.equal(body.packages[1].badge, 'best');
  } finally {
    d1.close();
  }
});

test('credit packages endpoint isolates packages by project', async () => {
  const d1 = createSchemaBackedD1();

  try {
    await d1.prepare(`
      INSERT INTO credit_packages
        (id, project_id, package_id, name, credits, platform, currency, amount_cents, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind('new_site_10', 'new-site', '10', '10 Credits', 10, 'paypal', 'USD', 199, 1).run();

    const response = await packagesHandler({
      request: new Request('https://example.test/api/credit-packages?platform=paypal'),
      env: envFor(d1, 'new-site'),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.packages.map((pack) => pack.id), ['10']);
  } finally {
    d1.close();
  }
});

test('credit packages endpoint requires database binding', async () => {
  const response = await packagesHandler({
    request: new Request('https://example.test/api/credit-packages?platform=paypal'),
    env: {},
  });
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.equal(body.success, false);
  assert.equal(body.error, 'Database not configured');
});

