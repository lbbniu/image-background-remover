'use client'

import { useState } from 'react'
import { PayPalButtons } from '@paypal/react-paypal-js'
import { useI18n } from '../i18n'

interface CreditPackCheckoutProps {
  packId: string
  credits: number
  price?: number
  onSuccess?: (credits: number) => void
}

export default function CreditPackCheckout({ packId, credits, onSuccess }: CreditPackCheckoutProps) {
  const { t } = useI18n()
  const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  if (status === 'success') {
    return (
      <div className="w-full py-2 text-center text-sm font-medium text-emerald-400">
        ✓ {t.pricing.paymentSuccess || 'Payment successful!'} +{credits} {t.pricing.packCredits}
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="w-full space-y-2">
        <div className="text-center text-sm text-red-400">
          {message || (t.pricing.paymentFailed || 'Payment failed')}
        </div>
        <button
          onClick={() => { setStatus('idle'); setMessage(''); }}
          className="w-full py-2 btn-secondary rounded-lg text-sm font-medium"
        >
          {t.pricing.tryAgain || 'Try Again'}
        </button>
      </div>
    )
  }

  if (status === 'processing') {
    return (
      <div className="w-full py-2 text-center text-sm text-gray-400">
        {t.pricing.paymentProcessing || 'Processing...'}
      </div>
    )
  }

  return (
    <div className="w-full paypal-button-container paypal-credit-button">
      <PayPalButtons
        fundingSource="paypal"
        style={{
          layout: 'horizontal',
          color: 'silver',
          shape: 'rect',
          label: 'pay',
          height: 35,
          tagline: false,
        }}
        createOrder={async () => {
          try {
            const res = await fetch('/api/credit-purchases/paypal-orders', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ packId }),
            })
            const data = await res.json()

            if (!data.success) {
              if (data.code === 'LOGIN_REQUIRED') {
                window.location.href = '/api/oauth/google/authorization'
                throw new Error('Login required')
              }
              throw new Error(data.error || 'Failed to create order')
            }

            setStatus('idle')
            return data.orderId
          } catch (err: unknown) {
            setStatus('error')
            setMessage(err instanceof Error ? err.message : 'Failed to create order')
            throw err
          }
        }}
        onApprove={async (data) => {
          setStatus('processing')
          try {
            const res = await fetch(`/api/credit-purchases/paypal-orders/${data.orderID}/capture`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
            })
            const result = await res.json()

            if (!result.success) {
              throw new Error(result.error || 'Payment capture failed')
            }

            setStatus('success')
            onSuccess?.(result.credits)
          } catch (err: unknown) {
            setStatus('error')
            setMessage(err instanceof Error ? err.message : 'Payment failed')
          }
        }}
        onError={(err) => {
          console.error('PayPal error:', err)
          setStatus('error')
          setMessage(t.pricing.paymentFailed || 'Payment failed. Please try again.')
        }}
        onCancel={() => {
          setStatus('idle')
        }}
      />
    </div>
  )
}
