const DEFAULT_API_BASE = 'https://api.creem.io';
const DEFAULT_TEST_API_BASE = 'https://test-api.creem.io';

function getApiBase(env) {
  if (env.CREEM_API_BASE) return env.CREEM_API_BASE;
  return env.CREEM_TEST_MODE === 'true' ? DEFAULT_TEST_API_BASE : DEFAULT_API_BASE;
}

function getApiKey(env) {
  const apiKey = env.CREEM_API_KEY;
  if (!apiKey) {
    throw new Error('Creem credentials not configured');
  }
  return apiKey;
}

function toSnakePayload({
  productId,
  requestId,
  successUrl,
  customer,
  metadata,
  discountCode,
}) {
  return {
    product_id: productId,
    ...(requestId ? { request_id: requestId } : {}),
    ...(successUrl ? { success_url: successUrl } : {}),
    ...(customer ? { customer } : {}),
    ...(metadata ? { metadata } : {}),
    ...(discountCode ? { discount_code: discountCode } : {}),
  };
}

export function isCreemConfigured(env) {
  return Boolean(env.CREEM_API_KEY);
}

export async function createCreemCheckout(env, options) {
  const response = await fetch(`${getApiBase(env)}/v1/checkouts`, {
    method: 'POST',
    headers: {
      'x-api-key': getApiKey(env),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(toSnakePayload(options)),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Creem create checkout failed: ${response.status} ${error}`);
  }

  return response.json();
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
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
  return bytesToHex(signature);
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

export async function verifyCreemWebhookSignature(env, request, rawBody) {
  const secret = env.CREEM_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('CREEM_WEBHOOK_SECRET not configured');
  }

  const signature = request.headers.get('creem-signature');
  if (!signature) return false;

  const computed = await hmacSha256Hex(secret, rawBody);
  return constantTimeEqual(computed.toLowerCase(), signature.toLowerCase());
}

export async function verifyCreemRedirectSignature(env, params) {
  const apiKey = getApiKey(env);
  const signature = params.signature;
  if (!signature) return false;

  const payload = Object.keys(params)
    .filter((key) => key !== 'signature' && params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');

  const computed = await hmacSha256Hex(apiKey, payload);
  return constantTimeEqual(computed.toLowerCase(), signature.toLowerCase());
}

