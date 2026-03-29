'use client'

import { PayPalScriptProvider } from '@paypal/react-paypal-js'
import { ReactNode } from 'react'

// 沙箱环境 Client ID（静态导出无法使用 process.env，直接硬编码）
const PAYPAL_CLIENT_ID = 'AUIEGYnxO4Ui31sjiz5PC_NtI2t-fbSmGzG1RXifsvYNSTFvRxF47OPNMYsAeFU0rG2CEe-M1zo9k5o7'

export default function PayPalProvider({ children }: { children: ReactNode }) {
  return (
    <PayPalScriptProvider
      options={{
        clientId: PAYPAL_CLIENT_ID,
        currency: 'USD',
        intent: 'capture',
        vault: true, // 需要 vault 来支持订阅
      }}
    >
      {children}
    </PayPalScriptProvider>
  )
}
