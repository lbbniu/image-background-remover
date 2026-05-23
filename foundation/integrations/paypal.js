// PayPal API 工具库（Cloudflare Workers 兼容，无 Node.js 依赖）

const PROD_API_BASE = 'https://api-m.paypal.com';
const SANDBOX_API_BASE = 'https://api-m.sandbox.paypal.com';

function isSandboxMode(env) {
  if (typeof env.PAYPAL_API_BASE === 'string' && env.PAYPAL_API_BASE.length) return null;
  return env.PAYPAL_SANDBOX === 'true' || env.PAYPAL_ENV === 'sandbox';
}

export function getApiBase(env) {
  if (env.PAYPAL_API_BASE) return env.PAYPAL_API_BASE;
  return isSandboxMode(env) ? SANDBOX_API_BASE : PROD_API_BASE;
}

export function getDefaultCurrency(env) {
  return env.PAYPAL_CURRENCY || 'USD';
}

// access_token 缓存：默认 9 小时（PayPal 一般 9h TTL，留 60s 余量）。
// 通过 env.PAYPAL_TOKEN_CACHE 可注入符合 KV-like 接口（put/get with json）的存储层；
// 否则使用模块级内存缓存。
const memoryTokenCache = new Map();

function tokenCacheKey(env) {
  return `paypal:token:${env.PAYPAL_CLIENT_ID || 'default'}:${getApiBase(env)}`;
}

async function readCachedToken(env) {
  const key = tokenCacheKey(env);
  const store = env.PAYPAL_TOKEN_CACHE;
  if (store && typeof store.get === 'function') {
    const cached = await store.get(key, { type: 'json' }).catch(() => null);
    if (cached?.accessToken && cached.expiresAt > Date.now()) {
      return cached.accessToken;
    }
    return null;
  }
  const cached = memoryTokenCache.get(key);
  if (cached?.expiresAt > Date.now()) return cached.accessToken;
  return null;
}

async function writeCachedToken(env, { accessToken, expiresInSeconds }) {
  const key = tokenCacheKey(env);
  const ttl = Math.max(60, Math.floor(expiresInSeconds) - 60);
  const expiresAt = Date.now() + ttl * 1000;
  const store = env.PAYPAL_TOKEN_CACHE;
  if (store && typeof store.put === 'function') {
    await store.put(key, JSON.stringify({ accessToken, expiresAt }), { expirationTtl: ttl }).catch(() => null);
    return;
  }
  memoryTokenCache.set(key, { accessToken, expiresAt });
}

export async function getAccessToken(env, { force = false } = {}) {
  const clientId = env.PAYPAL_CLIENT_ID;
  const clientSecret = env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('PayPal credentials not configured');
  }

  if (!force) {
    const cached = await readCachedToken(env);
    if (cached) return cached;
  }

  const auth = btoa(`${clientId}:${clientSecret}`);
  const response = await fetch(`${getApiBase(env)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`PayPal auth failed: ${response.status} ${error}`);
  }

  const data = await response.json();
  await writeCachedToken(env, {
    accessToken: data.access_token,
    expiresInSeconds: Number(data.expires_in) || 32400,
  });
  return data.access_token;
}

async function paypalFetch(env, path, init = {}, { retryOnAuth = true } = {}) {
  const accessToken = await getAccessToken(env);
  const response = await fetch(`${getApiBase(env)}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  if (response.status === 401 && retryOnAuth) {
    await getAccessToken(env, { force: true });
    return paypalFetch(env, path, init, { retryOnAuth: false });
  }
  return response;
}

async function ensureOk(response, label) {
  if (response.ok) return response;
  const error = await response.text();
  throw new Error(`PayPal ${label} failed: ${response.status} ${error}`);
}

export async function createOrder(env, amount, description, {
  customId,
  invoiceId,
  currency,
} = {}) {
  const response = await paypalFetch(env, '/v2/checkout/orders', {
    method: 'POST',
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: currency || getDefaultCurrency(env),
          value: amount,
        },
        description,
        ...(customId ? { custom_id: customId } : {}),
        ...(invoiceId ? { invoice_id: invoiceId } : {}),
      }],
    }),
  });
  await ensureOk(response, 'create order');
  return response.json();
}

export async function getOrderDetails(env, orderId) {
  const response = await paypalFetch(env, `/v2/checkout/orders/${orderId}`, { method: 'GET' });
  await ensureOk(response, 'get order');
  return response.json();
}

export async function captureOrder(env, orderId) {
  const response = await paypalFetch(env, `/v2/checkout/orders/${orderId}/capture`, { method: 'POST' });
  await ensureOk(response, 'capture order');
  return response.json();
}

export async function createProduct(env, name, description) {
  const response = await paypalFetch(env, '/v1/catalogs/products', {
    method: 'POST',
    body: JSON.stringify({
      name,
      description,
      type: 'SERVICE',
      category: 'SOFTWARE',
    }),
  });
  await ensureOk(response, 'create product');
  return response.json();
}

export async function createPlan(env, productId, planData) {
  const response = await paypalFetch(env, '/v1/billing/plans', {
    method: 'POST',
    body: JSON.stringify({
      product_id: productId,
      name: planData.name,
      description: planData.description,
      status: 'ACTIVE',
      billing_cycles: [
        {
          frequency: {
            interval_unit: planData.interval_unit,
            interval_count: planData.interval_count || 1,
          },
          tenure_type: 'REGULAR',
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: {
            fixed_price: {
              value: planData.price,
              currency_code: planData.currency || getDefaultCurrency(env),
            },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        payment_failure_threshold: 3,
      },
    }),
  });
  await ensureOk(response, 'create plan');
  return response.json();
}

export async function createSubscription(env, planId, {
  brandName,
  locale = 'en-US',
} = {}) {
  const response = await paypalFetch(env, '/v1/billing/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      plan_id: planId,
      application_context: {
        brand_name: brandName || env.PAYPAL_BRAND_NAME || 'Subscription',
        locale,
        shipping_preference: 'NO_SHIPPING',
        user_action: 'SUBSCRIBE_NOW',
      },
    }),
  });
  await ensureOk(response, 'create subscription');
  return response.json();
}

/**
 * 验证 PayPal Webhook 签名（调用 PayPal 官方验签 API）。
 * 必须传入原始 rawBody，不能再 JSON.parse → JSON.stringify。
 */
export async function verifyWebhookSignature(env, request, rawBody) {
  const webhookId = env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    throw new Error('PAYPAL_WEBHOOK_ID not configured');
  }

  const transmissionId = request.headers.get('PAYPAL-TRANSMISSION-ID');
  const transmissionTime = request.headers.get('PAYPAL-TRANSMISSION-TIME');
  const certUrl = request.headers.get('PAYPAL-CERT-URL');
  const authAlgo = request.headers.get('PAYPAL-AUTH-ALGO');
  const transmissionSig = request.headers.get('PAYPAL-TRANSMISSION-SIG');

  if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) {
    return false;
  }

  const response = await paypalFetch(env, '/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: JSON.stringify({
      auth_algo: authAlgo,
      cert_url: certUrl,
      transmission_id: transmissionId,
      transmission_sig: transmissionSig,
      transmission_time: transmissionTime,
      webhook_id: webhookId,
      webhook_event: JSON.parse(rawBody),
    }),
  });
  await ensureOk(response, 'verify webhook');
  const data = await response.json();
  return data.verification_status === 'SUCCESS';
}

export async function getSubscriptionDetails(env, subscriptionId) {
  const response = await paypalFetch(env, `/v1/billing/subscriptions/${subscriptionId}`, { method: 'GET' });
  await ensureOk(response, 'get subscription');
  return response.json();
}
