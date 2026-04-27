# ClearCut - Image Background Remover

智能抠图工具，基于 Next.js、Cloudflare Pages Functions、Cloudflare D1 和 Drizzle ORM。

## 特性

- 浏览器本地模型 + 云端抠图服务。
- 支持 Photoroom、BRIA、remove.bg。
- 内置 Google OAuth、JWT session、订阅、积分、支付、Webhook、账本和对账能力。
- `foundation/` 提供可复用后端底座，适合快速创建新站点。

## 快速开始

```bash
npm install
cp .env.example .env.local
npm run dev
```

访问：

```text
http://localhost:3000
```

## 常用命令

```bash
npm run test:coverage
npm run lint
npm run build
npm run credits:reconcile -- --db clearcut-db --project clearcut --remote
```

## 部署

初始化 D1：

```bash
npx wrangler d1 execute clearcut-db --remote --file=schema.sql
```

部署 Cloudflare Pages：

```bash
npm run build
npx wrangler pages deploy out --project-name=clearcut
```

## 文档

- [文档目录](docs/README.md)

## 许可

MIT License
