# 新项目接入通用后端底座

账号、OAuth、订阅、积分、支付、Webhook 和接口计费属于通用后端底座。新项目只需要复用底座模块，配置自己的 `PROJECT_ID`、套餐、支付平台价格和接口计费规则，然后开发前端页面和业务 feature。

## 代码分层

```text
functions/
  api/                  # Cloudflare Pages Functions 路由入口，只做 HTTP handler

foundation/
  modules/              # 可复用后端底座
    auth/               # JWT session、OAuth 用户绑定
    core/               # project_id、URL、OAuth redirect 等基础能力
    billing/            # usage_pricing 接口计费规则
    credits/            # 余额、扣减、退款、账本、明细
    payments/           # 积分包、购买记录、支付事件
    plans/              # 套餐和支付价格映射
    subscriptions/      # 订阅激活、续期、取消

  integrations/         # 第三方平台适配
    creem.js
    mock-payments.js
    paypal.js

  features/             # 当前项目业务能力
    background-removal.js
```

接入原则：
- `functions/api/` 保持薄层，只处理 HTTP 请求、鉴权和调用底座模块。
- `foundation/modules/` 放通用能力，新项目应优先复用，不要写项目业务。
- `foundation/integrations/` 放 PayPal、Stripe、Creem、Photoroom 等外部平台适配。
- `foundation/features/` 放当前站点业务能力，新项目通常替换这里。
- 通用模块统一从各目录的 `index.js` 引入，不直接依赖内部 `service.js`。

## 复制清单

从本项目复制以下目录和文件：

```text
db/
schema.sql
foundation/modules/auth/
foundation/modules/core/
foundation/modules/billing/
foundation/modules/credits/
foundation/modules/payments/
foundation/modules/plans/
foundation/modules/subscriptions/
foundation/integrations/
functions/api/oauth/
functions/api/me/
functions/api/credit-packages.js
functions/api/plan-prices.js
functions/api/subscriptions.js
functions/api/subscription-checkout-sessions.js
functions/api/credit-purchases/
functions/api/webhooks/
scripts/reconcile-credits.mjs
```

具体业务能力放在：

```text
foundation/features/
functions/api/your-feature.js
```

推荐导入边界：

```js
import { getUser } from '../../foundation/modules/auth/index.js';
import { getProjectId } from '../../foundation/modules/core/index.js';
import { resolveUsageCharge } from '../../foundation/modules/billing/index.js';
import { consumeCredit } from '../../foundation/modules/credits/index.js';
```

## 初始化数据库

```bash
npx wrangler d1 execute your-db-name --remote --file=schema.sql
```

当前底座包含 12 张表：

```text
账号层:
users / oauth_accounts

配置层:
subscription_plans / plan_prices / usage_pricing / credit_packages

状态层:
user_quotas / subscriptions / credit_purchases

审计层:
payment_events / credit_transactions / usage_logs
```

## 环境变量

每个新项目至少配置：

```bash
PROJECT_ID=new-site
APP_URL=https://new-site.com
JWT_SECRET=your-random-secret

GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=your-paypal-client-id
PAYPAL_CLIENT_SECRET=your-paypal-client-secret
PAYPAL_WEBHOOK_ID=your-paypal-webhook-id

NEXT_PUBLIC_PAYMENT_PLATFORM=paypal

CREEM_API_KEY=your-creem-api-key
CREEM_WEBHOOK_SECRET=your-creem-webhook-secret
CREEM_TEST_MODE=true

CREDIT_CONSUME_ORDER=monthly,purchased,gifted
```

支付平台说明：
- `NEXT_PUBLIC_PAYMENT_PLATFORM=paypal` 使用 PayPal JS Buttons。
- `NEXT_PUBLIC_PAYMENT_PLATFORM=creem` 使用 Creem hosted checkout。
- Stripe 当前仍是 mock provider。

Stripe mock 或本地 fallback 需要显式开启：

```bash
PAYMENT_MOCK_ENABLED=true
```

生产环境不要开启 `PAYMENT_MOCK_ENABLED`，否则 mock confirm 会直接完成购买或订阅激活。

Cloudflare Pages Secret 示例：

```bash
printf 'new-site' | npx wrangler pages secret put PROJECT_ID --project-name=new-site
printf 'https://new-site.com' | npx wrangler pages secret put APP_URL --project-name=new-site
printf 'your-random-secret' | npx wrangler pages secret put JWT_SECRET --project-name=new-site
printf 'monthly,purchased,gifted' | npx wrangler pages secret put CREDIT_CONSUME_ORDER --project-name=new-site
printf 'creem' | npx wrangler pages secret put NEXT_PUBLIC_PAYMENT_PLATFORM --project-name=new-site
printf 'your-creem-api-key' | npx wrangler pages secret put CREEM_API_KEY --project-name=new-site
printf 'your-creem-webhook-secret' | npx wrangler pages secret put CREEM_WEBHOOK_SECRET --project-name=new-site
printf 'true' | npx wrangler pages secret put CREEM_TEST_MODE --project-name=new-site
```

## 套餐和支付价格

套餐属于运营数据，按 `project_id` 写入 D1，不需要改接口代码。

```sql
INSERT OR IGNORE INTO subscription_plans (
  id, project_id, name, price_monthly, price_yearly, credits_monthly, features
) VALUES
  ('free', 'new-site', 'Free', 0, 0, 10, '["standard_quality"]'),
  ('pro', 'new-site', 'Pro', 1299, 12990, 300, '["hd_quality", "priority"]');

INSERT OR IGNORE INTO plan_prices (
  id, project_id, plan_id, platform, external_id, interval, currency, amount_cents
) VALUES
  ('paypal_pro_monthly', 'new-site', 'pro', 'paypal', 'PAYPAL_PLAN_ID', 'month', 'USD', 1299),
  ('stripe_pro_monthly', 'new-site', 'pro', 'stripe', 'STRIPE_PRICE_ID', 'month', 'USD', 1299),
  ('creem_pro_monthly',  'new-site', 'pro', 'creem',  'CREEM_PRODUCT_ID', 'month', 'USD', 1299);
```

字段约定：
- `subscription_plans.credits_monthly` 是订阅每个周期发放的月度额度。
- `plan_prices.platform` 支持 `paypal`、`stripe`、`creem` 等支付平台。
- `plan_prices.external_id` 存支付平台的 plan / price / product ID。
- `plan_prices.interval` 使用 `month`、`year`、`one_time`。

## 接口计费规则

D1 `usage_pricing` 决定本次接口调用应扣多少积分，`CREDIT_CONSUME_ORDER` 决定从哪类余额中扣。

```sql
INSERT OR IGNORE INTO usage_pricing (
  id, project_id, action, variant, credits, cost_estimate_cents, metadata
) VALUES
  ('image_generate_default',      'new-site', 'image.generate',    'default',   5, 3,  '{"model":"default"}'),
  ('background_remove_photoroom', 'new-site', 'background.remove', 'photoroom', 2, 2,  '{"provider":"photoroom"}'),
  ('background_remove_removebg',  'new-site', 'background.remove', 'removebg',  10, 20, '{"provider":"remove.bg"}');
```

匹配优先级：
- 同一 `project_id` 下优先匹配 `action + variant`。
- 如果没有精确 `variant`，匹配 `variant = 'default'` 的动作默认价。
- 数据库没有规则时才使用代码内置默认值，避免开发环境空库不可用；生产应显式写入 `usage_pricing`。

## 业务接口扣费模板

业务接口只声明动作和变体，不要写死扣费数字。

```js
import { getUser } from '../../foundation/modules/auth/index.js';
import { getProjectId } from '../../foundation/modules/core/index.js';
import { resolveUsageCharge } from '../../foundation/modules/billing/index.js';
import {
  consumeCredit,
  getCreditConsumeOrder,
  getUserCreditBalance,
  refundCredit,
  updateUsageLog,
} from '../../foundation/modules/credits/index.js';

export async function onRequestPost({ request, env }) {
  const user = await getUser(request, env);
  if (!user) {
    return Response.json({ success: false, code: 'LOGIN_REQUIRED' }, { status: 401 });
  }

  const projectId = getProjectId(env);
  const jobId = crypto.randomUUID();
  const charge = await resolveUsageCharge(env.DB, {
    projectId,
    action: 'image.generate',
    variant: 'default',
  });

  const balance = await getUserCreditBalance(env.DB, { userId: user.sub, projectId });
  if (!balance.allowed || balance.remaining < charge.credits) {
    return Response.json({
      success: false,
      code: 'NO_CREDITS',
      required: charge.credits,
      remaining: balance.remaining,
    }, { status: 403 });
  }

  const deduction = await consumeCredit(env.DB, {
    userId: user.sub,
    projectId,
    jobId,
    credits: charge.credits,
    consumeOrder: getCreditConsumeOrder(env),
  });

  try {
    const result = await runYourFeature(request);
    await updateUsageLog(env.DB, {
      jobId,
      metadata: {
        usagePricingKey: charge.pricingKey,
        usageAction: charge.action,
        usageVariant: charge.variant,
        costEstimateCents: charge.costEstimateCents,
      },
    });
    return Response.json({ success: true, result, creditsRemaining: deduction.remaining });
  } catch (error) {
    await refundCredit(env.DB, { userId: user.sub, projectId, jobId });
    throw error;
  }
}
```

## 余额扣减顺序

```bash
CREDIT_CONSUME_ORDER=monthly,purchased,gifted
```

可选来源：
- `monthly`: 订阅周期额度。
- `purchased`: 用户单独购买的积分。
- `gifted`: 注册奖励、运营赠送等积分。

常用策略：

```bash
CREDIT_CONSUME_ORDER=monthly,purchased,gifted
CREDIT_CONSUME_ORDER=gifted,monthly,purchased
CREDIT_CONSUME_ORDER=purchased,gifted,monthly
```

## 可复用接口

当前 PayPal 和 Creem 是真实支付链路。Stripe 仍是 mock provider，用于新项目接入联调、自动化测试和前端流程开发。

```text
GET  /api/oauth/google/authorization
GET  /api/oauth/google/callback
GET  /api/me
GET  /api/me/credits
GET  /api/me/credits/transactions
GET  /api/credit-packages?platform=paypal
GET  /api/plan-prices?platform=paypal
POST /api/subscriptions
POST /api/subscription-checkout-sessions
POST /api/credit-purchases/paypal-orders
POST /api/credit-purchases/paypal-orders/:orderId/capture
POST /api/credit-purchases/checkout-sessions
POST /api/credit-purchases/checkout-sessions/:sessionId/confirm
POST /api/webhooks/paypal
POST /api/webhooks/creem
```

如果新项目接 Creem，配置 `NEXT_PUBLIC_PAYMENT_PLATFORM=creem`，并把 `plan_prices.external_id`、`credit_packages.external_id` 替换为 Creem Dashboard 中的产品 ID。

如果要先开发 Stripe 前端流程，可以使用 mock checkout：

```bash
curl -X POST https://your-site.com/api/credit-purchases/checkout-sessions \
  -H 'Content-Type: application/json' \
  -d '{"platform":"stripe","packId":"50"}'
```

mock confirm：

```bash
curl -X POST https://your-site.com/api/credit-purchases/checkout-sessions/{sessionId}/confirm \
  -H 'Content-Type: application/json' \
  -d '{"platform":"stripe"}'
```

mock 订阅激活复用 `/api/subscriptions`：

```json
{
  "platform": "stripe",
  "externalId": "sub_mock_123",
  "priceExternalId": "price_mock_pro_monthly"
}
```

Creem 真实支付不走 mock confirm，创建 checkout 后跳转到 `checkoutUrl`，权益发放依赖 `/api/webhooks/creem`。

## 积分包

积分包属于运营数据，按 `project_id + platform` 写入 D1。

```sql
INSERT OR IGNORE INTO credit_packages (
  id, project_id, package_id, name, credits, platform, currency, amount_cents, badge, sort_order
) VALUES
  ('paypal_50_credits',  'new-site', '50',  '50 Credits',  50,  'paypal', 'USD', 499,  NULL,   10),
  ('paypal_200_credits', 'new-site', '200', '200 Credits', 200, 'paypal', 'USD', 1499, 'best', 20),
  ('paypal_500_credits', 'new-site', '500', '500 Credits', 500, 'paypal', 'USD', 2999, NULL,   30);
```

如果要联调 Stripe mock，也需要为 Stripe 写入相同 `package_id`：

```sql
INSERT OR IGNORE INTO credit_packages (
  id, project_id, package_id, name, credits, platform, external_id, currency, amount_cents, badge, sort_order
) VALUES
  ('stripe_50_credits', 'new-site', '50', '50 Credits', 50, 'stripe', 'price_mock_50_credits', 'USD', 499, NULL, 10);
```

## 积分对账

`user_quotas` 是余额快照，`credit_transactions` 是账本。上线后建议定期运行只读对账脚本：

```bash
npm run credits:reconcile -- --db clearcut-db --project clearcut --remote
npm run credits:reconcile -- --db clearcut-db --project clearcut --remote --json
```

脚本只报告问题，不会自动修改余额。发现 drift 后应先确认对应支付、退款或业务扣减流水，再决定是否人工修正。

## 接入检查清单

上线前确认：
- `PROJECT_ID` 已改为新项目 ID，且数据库配置数据也使用同一个 `project_id`。
- `subscription_plans` 至少包含 `free` 和一个付费套餐。
- `plan_prices.external_id` 已替换为真实 PayPal / Stripe / Creem 平台 ID。
- `credit_packages` 已写入积分包价格和积分数。
- `usage_pricing` 已写入业务接口动作的计费规则。
- `CREDIT_CONSUME_ORDER` 已按产品策略配置。
- 支付 Webhook 已配置到生产域名。
- 业务接口失败时会调用 `refundCredit` 退回已扣积分。
- 前端只展示价格和发起支付，不直接给用户加积分。

## 当前复用能力状态

已经通用化：
- 账号与 OAuth 用户绑定。
- JWT session 和登录态接口。
- 套餐配置 `subscription_plans`。
- 支付价格映射 `plan_prices`。
- 接口计费规则 `usage_pricing`。
- 积分包配置 `credit_packages`。
- 余额快照 `user_quotas`。
- 积分账本 `credit_transactions`。
- 积分使用明细接口。
- 只读积分对账脚本。
- Creem hosted checkout、Webhook 验签、积分购买入账和订阅激活。
- Stripe mock 支付 provider 和通用 checkout session 接口。

仍建议后续继续抽象：
- Stripe 真实 API 和 webhook handler。
- Webhook 统一事件模型。目前 `payment_events` 有幂等审计，但不同平台事件还未 normalize 成统一内部事件。
- 统一错误响应格式。目前仍有部分接口使用 `{ error }`，部分接口使用 `{ success, code }`。
- 项目配置 seed 脚本。目前新项目套餐、价格、积分包、计费规则仍主要通过 SQL 初始化。
