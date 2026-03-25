import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ClearCut - 3秒智能抠图',
  description: '无需注册，即传即走的AI抠图工具',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body className="bg-gray-50 min-h-screen">{children}</body>
    </html>
  )
}