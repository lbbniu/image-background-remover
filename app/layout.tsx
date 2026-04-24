'use client'

import './globals.css'
import { Inter } from 'next/font/google'
import { I18nProvider } from './i18n'

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
})

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <head>
        <title>ClearCut AI - 智能抠图</title>
        <meta name="description" content="AI 驱动的智能抠图工具，一键去除背景，支持批量处理" />
      </head>
      <body className={`${inter.className} relative min-h-screen`}>
        {/* Background orbs */}
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
        
        {/* Main content */}
        <div className="relative z-10">
          <I18nProvider>
            {children}
          </I18nProvider>
        </div>
      </body>
    </html>
  )
}
