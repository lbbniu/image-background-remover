// PayPal API 工具库（Cloudflare Workers 兼容，无 Node.js 依赖）

const DEFAULT_API_BASE = 'https://api-m.sandbox.paypal.com';

/**
 * 获取 PayPal OAuth 2.0 Access Token
 */
export async function getAccessToken(env) {
  const clientId = env.PAYPAL_CLIENT_ID;
  const clientSecret = env.PAYPAL_CLIENT_SECRET;
  const apiBase = env.PAYPAL_API_BASE || DEFAULT_API_BASE;

  if (!clientId || !clientSecret) {
    throw new Error('PayPal credentials not configured');
  }

  const auth = btoa(`${clientId}:${clientSecret}`);

  const response = await fetch(`${apiBase}/v1/oauth2/token`, {
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
  return data.access_token;
}

/**
 * 创建一次性支付订单 (Orders API v2)
 */
export async function createOrder(env, amount, description) {
  const apiBase = env.PAYPAL_API_BASE || DEFAULT_API_BASE;
  const accessToken = await getAccessToken(env);

  const response = await fetch(`${apiBase}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: 'USD',
          value: amount,
        },
        description,
      }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`PayPal create order failed: ${response.status} ${error}`);
  }

  return response.json();
}

/**
 * 确认（捕获）订单支付
 */
export async function captureOrder(env, orderId) {
  const apiBase = env.PAYPAL_API_BASE || DEFAULT_API_BASE;
  const accessToken = await getAccessToken(env);

  const response = await fetch(`${apiBase}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`PayPal capture order failed: ${response.status} ${error}`);
  }

  return response.json();
}

/**
 * 创建产品（Subscriptions API 前置步骤）
 */
export async function createProduct(env, name, description) {
  const apiBase = env.PAYPAL_API_BASE || DEFAULT_API_BASE;
  const accessToken = await getAccessToken(env);

  const response = await fetch(`${apiBase}/v1/catalogs/products`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      description,
      type: 'SERVICE',
      category: 'SOFTWARE',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`PayPal create product failed: ${response.status} ${error}`);
  }

  return response.json();
}

/**
 * 创建订阅计划 (Billing Plan)
 * planData: { name, description, interval_unit: 'MONTH'|'YEAR', interval_count: 1, price: '9.90' }
 */
export async function createPlan(env, productId, planData) {
  const apiBase = env.PAYPAL_API_BASE || DEFAULT_API_BASE;
  const accessToken = await getAccessToken(env);

  const response = await fetch(`${apiBase}/v1/billing/plans`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
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
          total_cycles: 0, // 0 = infinite
          pricing_scheme: {
            fixed_price: {
              value: planData.price,
              currency_code: 'USD',
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

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`PayPal create plan failed: ${response.status} ${error}`);
  }

  return response.json();
}

/**
 * 创建订阅
 */
export async function createSubscription(env, planId) {
  const apiBase = env.PAYPAL_API_BASE || DEFAULT_API_BASE;
  const accessToken = await getAccessToken(env);

  const response = await fetch(`${apiBase}/v1/billing/subscriptions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      plan_id: planId,
      application_context: {
        brand_name: 'ClearCut AI',
        locale: 'en-US',
        shipping_preference: 'NO_SHIPPING',
        user_action: 'SUBSCRIBE_NOW',
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`PayPal create subscription failed: ${response.status} ${error}`);
  }

  return response.json();
}

/**
 * 获取订阅详情
 */
export async function getSubscriptionDetails(env, subscriptionId) {
  const apiBase = env.PAYPAL_API_BASE || DEFAULT_API_BASE;
  const accessToken = await getAccessToken(env);

  const response = await fetch(`${apiBase}/v1/billing/subscriptions/${subscriptionId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`PayPal get subscription failed: ${response.status} ${error}`);
  }

  return response.json();
}
