'use client'

import './globals.css'
import { I18nProvider } from './i18n'
import PayPalProvider from './components/PayPalProvider'

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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="relative min-h-screen">
        {/* Background orbs */}
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
        
        {/* Main content */}
        <div className="relative z-10">
          <I18nProvider>
            <PayPalProvider>
              {children}
            </PayPalProvider>
          </I18nProvider>
        </div>
      </body>
    </html>
  )
}
