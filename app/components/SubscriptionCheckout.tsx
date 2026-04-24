'use client'

import { useState } from 'react'
import { PayPalButtons } from '@paypal/react-paypal-js'
import { useI18n } from '../i18n'

interface SubscriptionCheckoutProps {
  planId: string
  planName: string
  onSuccess?: (plan: string) => void
}

export default function SubscriptionCheckout({ planId, planName, onSuccess }: SubscriptionCheckoutProps) {
  const { t } = useI18n()
  const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  // Plan ID 是占位符时，显示 Coming Soon
  const isPlaceholder = !planId || planId.includes('PLACEHOLDER')

  if (isPlaceholder) {
    return (
      <button
        disabled
        className="block w-full text-center py-3 rounded-xl font-semibold btn-secondary opacity-50 cursor-not-allowed"
      >
        {t.pricing.comingSoon || 'Coming Soon'}
      </button>
    )
  }

  if (status === 'success') {
    return (
      <div className="w-full py-3 text-center text-sm font-medium text-emerald-400">
        ✓ {t.pricing.subscriptionSuccess || 'Subscription activated!'} — {planName}
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
          className="w-full py-3 btn-secondary rounded-xl text-sm font-semibold"
        >
          {t.pricing.tryAgain || 'Try Again'}
        </button>
      </div>
    )
  }

  if (status === 'processing') {
    return (
      <div className="w-full py-3 text-center text-sm text-gray-400">
        {t.pricing.paymentProcessing || 'Processing...'}
      </div>
    )
  }

  return (
    <div className="w-full paypal-button-container paypal-subscription-button">
      <PayPalButtons
        fundingSource="paypal"
        style={{
          layout: 'horizontal',
          color: 'gold',
          shape: 'rect',
          label: 'subscribe',
          height: 45,
          tagline: false,
        }}
        createSubscription={async (_data, actions) => {
          try {
            const subscriptionId = await actions.subscription.create({
              plan_id: planId,
            })
            return subscriptionId
          } catch (err) {
            console.error('Create subscription error:', err)
            setStatus('error')
            setMessage(t.pricing.paymentFailed || 'Failed to create subscription')
            throw err
          }
        }}
        onApprove={async (data) => {
          setStatus('processing')
          try {
            const res = await fetch('/api/subscriptions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ platform: 'paypal', externalId: data.subscriptionID }),
            })
            const result = await res.json()

            if (!result.success) {
              if (result.code === 'LOGIN_REQUIRED') {
                window.location.href = '/api/oauth/google/authorization'
                return
              }
              throw new Error(result.error || 'Subscription activation failed')
            }

            setStatus('success')
            onSuccess?.(result.plan)
          } catch (err: unknown) {
            setStatus('error')
            setMessage(err instanceof Error ? err.message : 'Subscription failed')
          }
        }}
        onError={(err) => {
          console.error('PayPal subscription error:', err)
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
