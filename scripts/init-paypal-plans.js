#!/usr/bin/env node

/**
 * 初始化 PayPal 订阅产品和计划
 * 
 * 用法:
 *   node scripts/init-paypal-plans.js
 * 
 * 需要环境变量:
 *   PAYPAL_CLIENT_ID
 *   PAYPAL_CLIENT_SECRET
 *   PAYPAL_API_BASE (默认 https://api-m.sandbox.paypal.com)
 * 
 * 输出: 创建的 Plan IDs，需要配置到 Cloudflare Pages 环境变量中
 */

const CLIENT_ID = process.env.PAYPAL_CLIENT_ID || 'AUIEGYnxO4Ui31sjiz5PC_NtI2t-fbSmGzG1RXifsvYNSTFvRxF47OPNMYsAeFU0rG2CEe-M1zo9k5o7';
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || 'EBwJ-hVdEAgTPIpZavTzewnE9ZoM9vVegHc3HT8oXJKOJyrG83xx6eh1KKkIOmjfw_W-';
const API_BASE = process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com';

async function getAccessToken() {
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Auth failed: ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

async function createProduct(accessToken) {
  const res = await fetch(`${API_BASE}/v1/catalogs/products`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'ClearCut AI Subscription',
      description: 'ClearCut AI background removal subscription service',
      type: 'SERVICE',
      category: 'SOFTWARE',
    }),
  });
  if (!res.ok) throw new Error(`Create product failed: ${await res.text()}`);
  return res.json();
}

async function createPlan(accessToken, productId, planData) {
  const res = await fetch(`${API_BASE}/v1/billing/plans`, {
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
            interval_count: 1,
          },
          tenure_type: 'REGULAR',
          sequence: 1,
          total_cycles: 0,
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
  if (!res.ok) throw new Error(`Create plan failed: ${await res.text()}`);
  return res.json();
}

async function main() {
  console.log('🚀 Initializing PayPal subscription plans...\n');
  console.log(`API Base: ${API_BASE}\n`);

  // 1. Get access token
  console.log('1. Getting access token...');
  const accessToken = await getAccessToken();
  console.log('   ✅ Access token obtained\n');

  // 2. Create product
  console.log('2. Creating product...');
  const product = await createProduct(accessToken);
  console.log(`   ✅ Product created: ${product.id}\n`);

  // 3. Create plans
  const plans = [
    {
      name: 'ClearCut Pro Monthly',
      description: 'Pro plan - 200 credits/month, billed monthly',
      interval_unit: 'MONTH',
      price: '9.90',
      envKey: 'PAYPAL_PLAN_PRO_MONTHLY',
    },
    {
      name: 'ClearCut Pro Yearly',
      description: 'Pro plan - 200 credits/month, billed yearly',
      interval_unit: 'YEAR',
      price: '79.00',
      envKey: 'PAYPAL_PLAN_PRO_YEARLY',
    },
    {
      name: 'ClearCut Business Monthly',
      description: 'Business plan - 1000 credits/month, billed monthly',
      interval_unit: 'MONTH',
      price: '29.90',
      envKey: 'PAYPAL_PLAN_BIZ_MONTHLY',
    },
    {
      name: 'ClearCut Business Yearly',
      description: 'Business plan - 1000 credits/month, billed yearly',
      interval_unit: 'YEAR',
      price: '239.00',
      envKey: 'PAYPAL_PLAN_BIZ_YEARLY',
    },
  ];

  console.log('3. Creating billing plans...');
  const results = {};

  for (const plan of plans) {
    const created = await createPlan(accessToken, product.id, plan);
    results[plan.envKey] = created.id;
    console.log(`   ✅ ${plan.name}: ${created.id}`);
  }

  console.log('\n========================================');
  console.log('✅ All plans created successfully!\n');
  console.log('Add these to your Cloudflare Pages environment variables:\n');
  console.log(`PAYPAL_PRODUCT_ID=${product.id}`);
  for (const [key, value] of Object.entries(results)) {
    console.log(`${key}=${value}`);
  }
  console.log('\n========================================');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
