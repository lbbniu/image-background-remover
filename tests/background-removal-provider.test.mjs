import test from 'node:test';
import assert from 'node:assert/strict';
import { selectBackgroundRemovalProvider } from '../foundation/features/index.js';

test('auto provider prefers low-cost Photoroom when configured', () => {
  const env = {
    PHOTOROOM_API_KEY: 'photoroom-key',
    REMOVE_BG_API_KEY: 'removebg-key',
  };

  assert.equal(selectBackgroundRemovalProvider(env), 'photoroom');
});

test('auto provider falls back to remove.bg when low-cost providers are missing', () => {
  const env = { REMOVE_BG_API_KEY: 'removebg-key' };

  assert.equal(selectBackgroundRemovalProvider(env), 'removebg');
});

test('explicit provider requires matching configuration', () => {
  assert.throws(
    () => selectBackgroundRemovalProvider({ BACKGROUND_REMOVAL_PROVIDER: 'photoroom' }),
    /not configured/,
  );
});
