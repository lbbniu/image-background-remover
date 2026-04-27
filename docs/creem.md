# Creem 支付接入

Creem 已接入真实 hosted checkout 和 webhook。用户点击支付后跳转到 Creem 收银台，支付成功后的权益发放以 `/api/webhooks/creem` 为准，前端成功跳转不直接加积分或激活订阅。

## 环境变量

本地 `.env.local` 或 `.env`：

```bash
NEXT_PUBLIC_PAYMENT_PLATFORM=creem

CREEM_API_KEY=your-creem-api-key
CREEM_WEBHOOK_SECRET=your-creem-webhook-secret
CREEM_TEST_MODE=true
```

可选：

```bash
CREEM_API_BASE=https://test-api.creem.io
```

规则：
- `NEXT_PUBLIC_PAYMENT_PLATFORM=creem` 会让 pricing 页使用 Creem hosted checkout。
- `CREEM_TEST_MODE=true` 默认使用 Creem test API。
- `CREEM_WEBHOOK_SECRET` 用于校验 `creem-signature`，生产必须配置。
- 不要在生产开启 `PAYMENT_MOCK_ENABLED`。

Cloudflare Pages Secret：

```bash
printf 'creem' | npx wrangler pages secret put NEXT_PUBLIC_PAYMENT_PLATFORM --project-name=clearcut
printf 'your-creem-api-key' | npx wrangler pages secret put CREEM_API_KEY --project-name=clearcut
printf 'your-creem-webhook-secret' | npx wrangler pages secret put CREEM_WEBHOOK_SECRET --project-name=clearcut
printf 'true' | npx wrangler pages secret put CREEM_TEST_MODE --project-name=clearcut
```

如果使用正式环境：

```bash
printf 'false' | npx wrangler pages secret put CREEM_TEST_MODE --project-name=clearcut
```

## 数据配置

`plan_prices.external_id` 需要填写 Creem 产品 ID：

```sql
UPDATE plan_prices
SET external_id = 'prod_YOUR_CREEM_PRO_MONTHLY'
WHERE project_id = 'clearcut'
  AND platform = 'creem'
  AND plan_id = 'pro'
  AND interval = 'month';
```

`credit_packages.external_id` 也需要填写 Creem 产品 ID：

```sql
UPDATE credit_packages
SET external_id = 'prod_YOUR_CREEM_50_CREDITS'
WHERE project_id = 'clearcut'
  AND platform = 'creem'
  AND package_id = '50';
```

生产环境不要继续使用 `creem_mock_*`。这些值只适合本地 mock、测试库或尚未创建 Creem 产品时的占位。

## 接口

积分包 checkout：

```http
POST /api/credit-purchases/checkout-sessions
Content-Type: application/json

{
  "platform": "creem",
  "packId": "50"
}
```

订阅 checkout：

```http
POST /api/subscription-checkout-sessions
Content-Type: application/json

{
  "platform": "creem",
  "priceExternalId": "prod_YOUR_CREEM_PRO_MONTHLY"
}
```

Webhook：

```text
POST /api/webhooks/creem
```

在 Creem Dashboard 的 Developers / Webhooks 中配置完整 URL：

```text
https://your-domain.com/api/webhooks/creem
```

## 入账规则

积分购买：
- 创建 checkout 时先写入 `credit_purchases`，状态为 `pending`。
- 收到 `checkout.completed` webhook 后校验签名。
- 根据 checkout id 找到本地 pending purchase。
- 调用 `completeCreditPurchase` 增加 `credits_purchased`，写入 `credit_transactions`。
- 重复 webhook 通过 `payment_events` 和 `credit_transactions` 幂等处理。

订阅：
- 创建 checkout 时把 `userId`、`planId`、`priceExternalId` 写入 Creem metadata。
- 收到 `checkout.completed`、`subscription.active`、`subscription.trialing`、`subscription.paid` 后激活订阅。
- 收到 `subscription.canceled`、`subscription.expired`、`subscription.paused` 后更新订阅状态。

## 测试

```bash
npm run test:coverage
npm run lint
npm run build
```
