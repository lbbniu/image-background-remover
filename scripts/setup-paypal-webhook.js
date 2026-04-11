#!/usr/bin/env node
/**
 * 自动注册 PayPal Webhook 并将 ID 设置到 Cloudflare Pages Secret
 *
 * 使用方式：
 *   PAYPAL_CLIENT_ID=xxx PAYPAL_CLIENT_SECRET=xxx \
 *   PAYPAL_API_BASE=https://api-m.paypal.com \
 *   node scripts/setup-paypal-webhook.js
 *
 * 或使用 sandbox：
 *   PAYPAL_API_BASE=https://api-m.sandbox.paypal.com \
 *   node scripts/setup-paypal-webhook.js
 */

const WEBHOOK_URL = 'https://ibr.zwlm.cc/api/paypal/webhook';
const CF_PROJECT = 'clearcut';

const LISTEN_EVENTS = [
  'BILLING.SUBSCRIPTION.ACTIVATED',
  'BILLING.SUBSCRIPTION.CANCELLED',
  'BILLING.SUBSCRIPTION.EXPIRED',
  'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
  'BILLING.SUBSCRIPTION.RENEWED',
  'BILLING.SUBSCRIPTION.PAYMENT.COMPLETED',
];

async function getAccessToken(apiBase, clientId, clientSecret) {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(`${apiBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function listWebhooks(apiBase, token) {
  const res = await fetch(`${apiBase}/v1/notifications/webhooks`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`List webhooks failed: ${res.status} ${await res.text()}`);
  return (await res.json()).webhooks || [];
}

async function createWebhook(apiBase, token) {
  const res = await fetch(`${apiBase}/v1/notifications/webhooks`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: WEBHOOK_URL,
      event_types: LISTEN_EVENTS.map((name) => ({ name })),
    }),
  });
  if (!res.ok) throw new Error(`Create webhook failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function setCloudflareSecret(projectName, secretName, secretValue) {
  const { execSync } = await import('child_process');
  execSync(
    `echo "${secretValue}" | wrangler pages secret put ${secretName} --project-name ${projectName}`,
    { stdio: 'inherit' }
  );
}

async function main() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const apiBase = process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com';

  if (!clientId || !clientSecret) {
    console.error('请设置 PAYPAL_CLIENT_ID 和 PAYPAL_CLIENT_SECRET 环境变量');
    process.exit(1);
  }

  console.log(`\n使用 API: ${apiBase}`);
  console.log(`Webhook URL: ${WEBHOOK_URL}\n`);

  const token = await getAccessToken(apiBase, clientId, clientSecret);
  console.log('✓ PayPal 认证成功');

  const existing = await listWebhooks(apiBase, token);
  let webhook = existing.find((w) => w.url === WEBHOOK_URL);

  if (webhook) {
    console.log(`✓ 已找到现有 Webhook: ${webhook.id}`);
  } else {
    console.log('  未找到已有 Webhook，正在创建...');
    webhook = await createWebhook(apiBase, token);
    console.log(`✓ Webhook 创建成功: ${webhook.id}`);
    console.log(`  监听事件: ${LISTEN_EVENTS.join(', ')}`);
  }

  console.log(`\n正在将 PAYPAL_WEBHOOK_ID 写入 Cloudflare Pages (${CF_PROJECT})...`);
  await setCloudflareSecret(CF_PROJECT, 'PAYPAL_WEBHOOK_ID', webhook.id);
  console.log('\n✓ 全部完成！PAYPAL_WEBHOOK_ID 已配置到 Cloudflare。');
  console.log('  重新部署后生效（推送代码或在 Cloudflare Pages 手动触发 redeploy）。');
}

main().catch((err) => {
  console.error('\n错误:', err.message);
  process.exit(1);
});
