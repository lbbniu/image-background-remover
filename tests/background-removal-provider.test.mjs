import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getBackgroundRemovalCreditCost,
  selectBackgroundRemovalProvider,
} from '../functions/features/background-removal.js';

test('auto provider prefers low-cost Photoroom when configured', () => {
  const env = {
    PHOTOROOM_API_KEY: 'photoroom-key',
    REMOVE_BG_API_KEY: 'removebg-key',
  };

  assert.equal(selectBackgroundRemovalProvider(env), 'photoroom');
  assert.equal(getBackgroundRemovalCreditCost(env, 'photoroom'), 2);
});

test('auto provider falls back to remove.bg when low-cost providers are missing', () => {
  const env = { REMOVE_BG_API_KEY: 'removebg-key' };

  assert.equal(selectBackgroundRemovalProvider(env), 'removebg');
  assert.equal(getBackgroundRemovalCreditCost(env, 'removebg'), 10);
});

test('explicit provider requires matching configuration', () => {
  assert.throws(
    () => selectBackgroundRemovalProvider({ BACKGROUND_REMOVAL_PROVIDER: 'photoroom' }),
    /not configured/,
  );
});

test('provider credit costs are configurable with safe fallback', () => {
  assert.equal(getBackgroundRemovalCreditCost({ PHOTOROOM_CREDIT_COST: '3' }, 'photoroom'), 3);
  assert.equal(getBackgroundRemovalCreditCost({ PHOTOROOM_CREDIT_COST: '-1' }, 'photoroom'), 2);
  assert.equal(getBackgroundRemovalCreditCost({ REMOVE_BG_CREDIT_COST: '8' }, 'removebg'), 8);
});
