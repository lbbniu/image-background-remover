# ClearCut - Image Background Remover

🖼️ 3秒智能抠图工具 - 基于 Next.js + Tailwind CSS

## ✨ 特性

- ⚡ **极速处理**：Next.js App Router，服务端API
- 🔒 **隐私优先**：图片仅内存处理，不落盘
- 📱 **全平台**：支持拖拽、粘贴、点击上传
- 🎨 **现代UI**：Tailwind CSS 精美界面
- 🚀 **易部署**：支持 Vercel、Docker 等多种方式

## 🛠️ 技术栈

- **框架**: Next.js 14 (App Router)
- **样式**: Tailwind CSS
- **语言**: TypeScript
- **API**: Remove.bg API

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
```
REMOVE_BG_API_KEY=your_api_key_here
```

获取 API Key: https://www.remove.bg/api

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

### Vercel (推荐)

```bash
npm i -g vercel
vercel
```

### Docker

```bash
docker build -t clearcut .
docker run -p 3000:3000 -e REMOVE_BG_API_KEY=xxx clearcut
```

## 💰 成本

- **Remove.bg**: 50张/月免费，超出 $0.2/张
- **Vercel**: 免费额度充足

## 📄 许可

MIT License
