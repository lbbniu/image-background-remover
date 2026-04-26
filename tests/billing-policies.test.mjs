import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveUsageCharge } from '../functions/lib/billing/policies.js';
import { createSchemaBackedD1 } from './d1-test-db.mjs';

test('resolves usage charge from database by project, action, and variant', async () => {
  const d1 = createSchemaBackedD1();

  try {
    const charge = await resolveUsageCharge(d1, {
      projectId: 'clearcut',
      action: 'background.remove',
      variant: 'removebg',
    });

    assert.equal(charge.credits, 10);
    assert.equal(charge.costEstimateCents, 20);
    assert.equal(charge.pricingKey, 'clearcut:background.remove:removebg');
    assert.deepEqual(charge.metadata, { provider: 'remove.bg' });
  } finally {
    d1.close();
  }
});

test('project specific database pricing overrides built-in defaults', async () => {
  const d1 = createSchemaBackedD1();

  try {
    await d1.prepare(`
      INSERT INTO usage_pricing
        (id, project_id, action, variant, credits, cost_estimate_cents, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      'background_remove_removebg',
      'new-site',
      'background.remove',
      'removebg',
      12,
      25,
      '{"tier":"premium"}',
    ).run();

    const charge = await resolveUsageCharge(d1, {
      projectId: 'new-site',
      action: 'background.remove',
      variant: 'removebg',
    });

    assert.equal(charge.credits, 12);
    assert.equal(charge.costEstimateCents, 25);
    assert.equal(charge.pricingKey, 'new-site:background.remove:removebg');
    assert.deepEqual(charge.metadata, { tier: 'premium' });
  } finally {
    d1.close();
  }
});

test('database default variant applies when action variant has no exact rule', async () => {
  const d1 = createSchemaBackedD1();

  try {
    await d1.prepare(`
      INSERT INTO usage_pricing
        (id, project_id, action, variant, credits, cost_estimate_cents)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind('custom_default', 'clearcut', 'custom.action', 'default', 4, 1).run();

    const charge = await resolveUsageCharge(d1, {
      projectId: 'clearcut',
      action: 'custom.action',
      variant: 'slow',
    });

    assert.equal(charge.credits, 4);
    assert.equal(charge.costEstimateCents, 1);
    assert.equal(charge.pricingKey, 'clearcut:custom.action:default');
  } finally {
    d1.close();
  }
});

test('built-in pricing is only a fallback when database has no rule', async () => {
  const d1 = createSchemaBackedD1();

  try {
    await d1.prepare('DELETE FROM usage_pricing').run();

    const charge = await resolveUsageCharge(d1, {
      projectId: 'clearcut',
      action: 'background.remove',
      variant: 'photoroom',
    });

    assert.equal(charge.credits, 2);
    assert.equal(charge.costEstimateCents, 2);
    assert.equal(charge.pricingKey, 'background.remove:photoroom');
  } finally {
    d1.close();
  }
});

test('invalid database pricing is rejected', async () => {
  const d1 = createSchemaBackedD1();

  try {
    await d1.prepare(`
      INSERT INTO usage_pricing
        (id, project_id, action, variant, credits, cost_estimate_cents)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind('bad_price', 'clearcut', 'custom.bad', 'default', 0, 0).run();

    await assert.rejects(
      () => resolveUsageCharge(d1, {
        projectId: 'clearcut',
        action: 'custom.bad',
      }),
      /Invalid usage pricing credits/,
    );
  } finally {
    d1.close();
  }
});

