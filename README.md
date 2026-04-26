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

## 🧩 新站点快速复用

账号、OAuth、订阅、积分、支付和 Webhook 属于通用后端底座。新站点只需要复用这些目录，再开发自己的前端页面和业务 feature。

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

业务能力放在：

```text
functions/features/
functions/api/your-feature.js
```

### 套餐配置

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
  ('paypal_pro_monthly', 'new-site', 'pro', 'paypal', 'PAYPAL_PLAN_ID', 'month', 'USD', 1299);
```

字段约定：
- `subscription_plans.credits_monthly` 是订阅每个周期发放的月度额度。
- `plan_prices.platform` 支持 `paypal`、`stripe`、`creem` 等支付平台。
- `plan_prices.external_id` 存支付平台的 plan / price / product ID。
- `plan_prices.interval` 使用 `month`、`year`、`one_time`。

### 积分扣减策略

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
  ('background_remove_photoroom', 'new-site', 'background.remove', 'photoroom', 2, 2,  '{"provider":"photoroom"}'),
  ('background_remove_bria',      'new-site', 'background.remove', 'bria',      2, 2,  '{"provider":"bria"}'),
  ('background_remove_removebg',  'new-site', 'background.remove', 'removebg',  10, 20, '{"provider":"remove.bg"}');
```

匹配优先级：
- 同一 `project_id` 下优先匹配 `action + variant`。
- 如果没有精确 `variant`，匹配 `variant = 'default'` 的动作默认价。
- 数据库没有规则时才使用代码内置默认值，避免开发环境空库不可用；生产应显式写入 `usage_pricing`。

业务接口只需要声明动作和变体：

```js
import { resolveUsageCharge } from '../lib/billing/policies.js';
import { consumeCredit, getCreditConsumeOrder } from '../lib/credits/service.js';

const charge = await resolveUsageCharge(env.DB, {
  projectId,
  action: 'background.remove',
  variant: provider,
});

await consumeCredit(env.DB, {
  userId,
  projectId,
  jobId,
  credits: charge.credits,
  consumeOrder: getCreditConsumeOrder(env),
});
```

余额扣减顺序通过环境变量独立配置。

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

### 单独购买积分包

当前积分包配置在 `functions/lib/payments/credit-purchases.js` 的 `getCreditPackages()` 中：

```js
export function getCreditPackages() {
  return {
    '50': { credits: 50, price: '4.99', label: '50 Credits' },
    '200': { credits: 200, price: '14.99', label: '200 Credits' },
    '500': { credits: 500, price: '29.99', label: '500 Credits' },
  };
}
```

新站点如果积分包不同，先调整这里。后续如果需要后台化管理，可以新增 `credit_packages` 配置表，把积分包从代码迁移到 D1。

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
