const MOCK_PLATFORMS = new Set(['stripe', 'creem']);

export function isMockPaymentPlatform(platform) {
  return MOCK_PLATFORMS.has(platform);
}

export function isPaymentMockEnabled(env) {
  return env.PAYMENT_MOCK_ENABLED === 'true';
}

export function assertMockPaymentEnabled(env, platform) {
  if (!isMockPaymentPlatform(platform)) {
    throw new Error(`Unsupported mock payment platform: ${platform}`);
  }
  if (!isPaymentMockEnabled(env)) {
    throw new Error(`${platform} mock payment is disabled`);
  }
}

export function createMockCheckoutSession(env, {
  platform,
  kind,
  amountCents,
  currency = 'USD',
  description,
  successUrl,
  cancelUrl,
  metadata = {},
}) {
  assertMockPaymentEnabled(env, platform);

  const prefix = platform === 'stripe' ? 'cs' : 'creem_checkout';
  const sessionId = `${prefix}_mock_${crypto.randomUUID()}`;
  const url = new URL(successUrl || env.APP_URL || 'https://example.test');
  url.searchParams.set('mock_payment', 'success');
  url.searchParams.set('platform', platform);
  url.searchParams.set('session_id', sessionId);

  return {
    id: sessionId,
    url: url.toString(),
    cancelUrl,
    platform,
    kind,
    amountCents,
    currency,
    description,
    metadata,
    mock: true,
  };
}

