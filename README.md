# ClearCut - Image Background Remover

🖼️ 智能抠图工具 - 基于 Next.js + Cloudflare Pages Functions + D1

## ✨ 特性

- ⚡ **极速处理**：Next.js App Router，服务端API
- 🔒 **隐私优先**：图片仅内存处理，不落盘
- 📱 **全平台**：支持拖拽、粘贴、点击上传
- 🎨 **现代UI**：Tailwind CSS 精美界面
- 💳 **支付闭环**：支持 PayPal 订阅、积分购买、Webhook 补偿
- 🧩 **模块化后端**：账号、积分、订阅、支付能力可复用
- 🚀 **易部署**：支持 Cloudflare Pages + D1

## 🛠️ 技术栈

- **框架**: Next.js 16 (App Router)
- **样式**: Tailwind CSS
- **语言**: TypeScript
- **数据库**: Cloudflare D1 + Drizzle ORM
- **抠图 API**: Photoroom / BRIA / remove.bg

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env.local
```

编辑 `.env.local`：
```bash
# Project isolation.
# 新站点必须使用独立 PROJECT_ID；同一个 D1 可以承载多个项目。
PROJECT_ID=clearcut

# Credit consume strategy.
# 可选值: monthly / purchased / gifted，按逗号顺序扣减。
CREDIT_CONSUME_ORDER=monthly,purchased,gifted

# Background removal provider.
# 可选值: auto / photoroom / bria / removebg / remove.bg
# auto 优先级: Photoroom -> BRIA -> remove.bg
BACKGROUND_REMOVAL_PROVIDER=auto

# Photoroom Remove Background API
# 默认作为低成本云端 provider。
PHOTOROOM_API_KEY=your_photoroom_api_key_here

# BRIA Background Removal API
# BRIA_API_URL 需要按你的 BRIA 账号/API 网关填写。
BRIA_API_KEY=your_bria_api_key_here
BRIA_API_URL=https://your-bria-background-removal-endpoint

# remove.bg API
# 作为高成本 premium fallback。
REMOVE_BG_API_KEY=your_api_key_here
```

API Key 获取地址：
- Photoroom: https://www.photoroom.com/api
- BRIA: https://bria.ai/api/
- remove.bg: https://www.remove.bg/api

配置规则：
- `PROJECT_ID` 是多项目隔离键，新站点不要复用 `clearcut`。
- `CREDIT_CONSUME_ORDER` 控制扣减顺序，例如 `gifted,monthly,purchased` 表示先扣赠送积分。
- 接口动作扣多少站内积分由 D1 `usage_pricing` 表控制。
- `BACKGROUND_REMOVAL_PROVIDER=auto` 时，系统会选择第一个已配置的 provider。
- 配置了 `PHOTOROOM_API_KEY` 会优先使用 Photoroom。
- 配置了 `BRIA_API_KEY` 和 `BRIA_API_URL` 才会启用 BRIA。
- 只配置 `REMOVE_BG_API_KEY` 时会继续使用 remove.bg。
- `usage_pricing.credits` 是对用户扣减的站内积分，不是三方平台实际扣费。
- `usage_pricing.cost_estimate_cents` 是内部成本估算，用于记录和分析，不参与真实扣款。

### Cloudflare Pages Secret

生产环境用 Wrangler 写入 Pages Secret：

```bash
printf 'clearcut' | npx wrangler pages secret put PROJECT_ID --project-name=clearcut
printf 'monthly,purchased,gifted' | npx wrangler pages secret put CREDIT_CONSUME_ORDER --project-name=clearcut
printf 'auto' | npx wrangler pages secret put BACKGROUND_REMOVAL_PROVIDER --project-name=clearcut
printf 'your_photoroom_api_key_here' | npx wrangler pages secret put PHOTOROOM_API_KEY --project-name=clearcut
printf 'your_bria_api_key_here' | npx wrangler pages secret put BRIA_API_KEY --project-name=clearcut
printf 'https://your-bria-background-removal-endpoint' | npx wrangler pages secret put BRIA_API_URL --project-name=clearcut
printf 'your_remove_bg_api_key_here' | npx wrangler pages secret put REMOVE_BG_API_KEY --project-name=clearcut
```

## 🧩 新项目接入通用后端底座

账号、OAuth、订阅、积分、支付、Webhook 和接口计费属于通用后端底座。新项目只需要复用底座模块，配置自己的 `PROJECT_ID`、套餐、支付平台价格和接口计费规则，然后开发前端页面和业务 feature。

### 1. 复制通用模块

从本项目复制以下目录和文件：

```text
db/
schema.sql
functions/lib/core/
functions/lib/credits/
functions/lib/payments/
functions/lib/plans/
functions/lib/subscriptions/
functions/lib/oauth.js
functions/api/oauth/
functions/api/me/
functions/api/plan-prices.js
functions/api/subscriptions.js
functions/api/credit-purchases/
functions/api/webhooks/
```

不要把具体业务能力放进 `functions/lib/`。业务能力放在：

```text
functions/features/
functions/api/your-feature.js
```

### 2. 初始化数据库

新项目可以使用独立 D1，也可以多个项目共用一个 D1。共用 D1 时必须保证每个项目使用独立 `PROJECT_ID`。

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

### 3. 配置环境变量

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

CREDIT_CONSUME_ORDER=monthly,purchased,gifted
```

Cloudflare Pages Secret 示例：

```bash
printf 'new-site' | npx wrangler pages secret put PROJECT_ID --project-name=new-site
printf 'https://new-site.com' | npx wrangler pages secret put APP_URL --project-name=new-site
printf 'your-random-secret' | npx wrangler pages secret put JWT_SECRET --project-name=new-site
printf 'monthly,purchased,gifted' | npx wrangler pages secret put CREDIT_CONSUME_ORDER --project-name=new-site
```

### 4. 配置套餐和支付价格

套餐属于运营数据，按 `project_id` 写入 D1，不需要改接口代码。新站点使用自己的 `PROJECT_ID` 后，插入对应套餐和支付平台价格映射即可。

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
  ('creem_pro_monthly',  'new-site', 'pro', 'creem',  'CREEM_PRICE_ID',  'month', 'USD', 1299);
```

字段约定：
- `subscription_plans.credits_monthly` 是订阅每个周期发放的月度额度。
- `plan_prices.platform` 支持 `paypal`、`stripe`、`creem` 等支付平台。
- `plan_prices.external_id` 存支付平台的 plan / price / product ID。
- `plan_prices.interval` 使用 `month`、`year`、`one_time`。

### 5. 配置接口计费规则

积分扣减分两层：D1 `usage_pricing` 决定本次接口调用应扣多少积分，`CREDIT_CONSUME_ORDER` 决定从哪类余额中扣。

完整链路：

```text
支付成功 / Webhook
-> 写入订阅或购买积分
-> 更新 user_quotas
-> 写入 credit_transactions
-> 业务接口调用 resolveUsageCharge 从 usage_pricing 取价
-> consumeCredit 按 CREDIT_CONSUME_ORDER 扣减余额
-> 写入 usage_logs 和 credit_transactions
```

接口扣费规则通过 D1 配置，不写死在业务接口里。

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

### 6. 业务接口接入扣费

业务接口只需要声明动作和变体，不要自己写死扣费数字。

```js
import { getUser } from '../lib/auth.js';
import { getProjectId } from '../lib/core/projects.js';
import { resolveUsageCharge } from '../lib/billing/policies.js';
import {
  consumeCredit,
  getCreditConsumeOrder,
  getUserCreditBalance,
  refundCredit,
  updateUsageLog,
} from '../lib/credits/service.js';

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

### 7. 配置余额扣减顺序

余额扣减顺序通过环境变量独立配置，不需要改代码。

```bash
CREDIT_CONSUME_ORDER=monthly,purchased,gifted
```

可选来源：
- `monthly`: 订阅周期额度。
- `purchased`: 用户单独购买的积分。
- `gifted`: 注册奖励、运营赠送等积分。

常用策略：

```bash
# 默认：优先消耗订阅额度，再消耗购买积分，最后消耗赠送积分。
CREDIT_CONSUME_ORDER=monthly,purchased,gifted

# 优先消耗赠送积分。
CREDIT_CONSUME_ORDER=gifted,monthly,purchased

# 保护订阅额度，优先消耗购买积分。
CREDIT_CONSUME_ORDER=purchased,gifted,monthly
```

### 8. 前端可直接复用的接口

通用后端已经提供这些 REST 风格接口：

```text
GET  /api/oauth/google/authorization
GET  /api/oauth/google/callback
GET  /api/me
GET  /api/me/credits
GET  /api/me/credits/transactions
GET  /api/credit-packages?platform=paypal
GET  /api/plan-prices?platform=paypal
POST /api/subscriptions
POST /api/credit-purchases/paypal-orders
POST /api/credit-purchases/paypal-orders/:orderId/capture
POST /api/webhooks/paypal
```

新项目前端通常只需要：
- 登录按钮跳转 `/api/oauth/google/authorization`。
- 个人中心请求 `/api/me` 和 `/api/me/credits`。
- 积分明细请求 `/api/me/credits/transactions?limit=20&offset=0`。
- 定价页请求 `/api/plan-prices?platform=paypal` 和 `/api/credit-packages?platform=paypal`。
- 业务页面调用自己的 `/api/your-feature`。

### 9. 单独购买积分包

积分包属于运营数据，按 `project_id + platform` 写入 D1，不需要改代码。

```sql
INSERT OR IGNORE INTO credit_packages (
  id, project_id, package_id, name, credits, platform, currency, amount_cents, badge, sort_order
) VALUES
  ('paypal_50_credits',  'new-site', '50',  '50 Credits',  50,  'paypal', 'USD', 499,  NULL,   10),
  ('paypal_200_credits', 'new-site', '200', '200 Credits', 200, 'paypal', 'USD', 1499, 'best', 20),
  ('paypal_500_credits', 'new-site', '500', '500 Credits', 500, 'paypal', 'USD', 2999, NULL,   30);
```

字段约定：
- `package_id` 是前端购买时传入的稳定 ID，例如 `50`、`200`。
- `credits` 是购买成功后增加到 `user_quotas.credits_purchased` 的积分数。
- `amount_cents` 是售价，支付创建订单和金额校验都以该值为准。
- `platform` 支持 `paypal`、`stripe`、`creem` 等支付平台。
- `badge` 是展示角标，例如 `best`。

### 10. 接入检查清单

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

### 3. 开发模式

```bash
npm run dev
```

访问 http://localhost:3000

### 4. 构建部署

```bash
npm run build
npm start
```

## 📁 项目结构

```
app/
├── api/remove-bg/route.ts  # API路由
├── layout.tsx              # 根布局
├── page.tsx               # 首页
└── globals.css            # 全局样式
```

## 🌐 部署

### Cloudflare Pages

```bash
npm run build
npx wrangler pages deploy out --project-name=clearcut
```

### D1 初始化

```bash
npx wrangler d1 execute clearcut-db --remote --file=schema.sql
```

## 💰 成本

- **Photoroom**: 适合作为默认云端 provider，站内默认扣 2 积分。
- **BRIA**: 适合作为备用低成本 provider，站内默认扣 2 积分。
- **remove.bg**: 作为 premium fallback，站内默认扣 10 积分。
- **浏览器本地模型**: 适合免费预览和低成本场景，不消耗云端 API 成本。

## 📄 许可

MIT License
