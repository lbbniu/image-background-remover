'use client'

import { useState } from 'react'
import { useI18n } from '../i18n'

type HostedCheckoutProps =
  | {
      type: 'credit'
      platform: 'creem' | 'stripe'
      packId: string
      credits: number
      onSuccess?: (credits: number) => void
    }
  | {
      type: 'subscription'
      platform: 'creem' | 'stripe'
      priceExternalId: string
      planName: string
      onSuccess?: (plan: string) => void
    }

export default function HostedCheckout(props: HostedCheckoutProps) {
  const { t } = useI18n()
  const [status, setStatus] = useState<'idle' | 'processing' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const startCheckout = async () => {
    setStatus('processing')
    setMessage('')

    try {
      const endpoint = props.type === 'credit'
        ? '/api/credit-purchases/checkout-sessions'
        : '/api/subscription-checkout-sessions'
      const payload = props.type === 'credit'
        ? { platform: props.platform, packId: props.packId }
        : { platform: props.platform, priceExternalId: props.priceExternalId }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json()

      if (!data.success) {
        if (data.code === 'LOGIN_REQUIRED') {
          window.location.href = '/api/oauth/google/authorization'
          return
        }
        throw new Error(data.error || 'Failed to create checkout')
      }

      if (data.mock && props.type === 'credit') {
        const confirm = await fetch(`/api/credit-purchases/checkout-sessions/${data.sessionId}/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform: props.platform }),
        })
        const result = await confirm.json()
        if (!result.success) throw new Error(result.error || 'Payment confirmation failed')
        props.onSuccess?.(result.credits)
        return
      }

      if (data.mock && props.type === 'subscription') {
        const confirm = await fetch('/api/subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform: props.platform,
            externalId: data.sessionId,
            priceExternalId: props.priceExternalId,
          }),
        })
        const result = await confirm.json()
        if (!result.success) throw new Error(result.error || 'Subscription activation failed')
        props.onSuccess?.(result.plan)
        return
      }

      window.location.href = data.checkoutUrl
    } catch (error: unknown) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : (t.pricing.paymentFailed || 'Payment failed'))
    }
  }

  if (status === 'error') {
    return (
      <div className="w-full space-y-2">
        <div className="text-center text-sm text-red-400">
          {message || (t.pricing.paymentFailed || 'Payment failed')}
        </div>
        <button
          onClick={() => { setStatus('idle'); setMessage('') }}
          className="w-full py-3 btn-secondary rounded-xl text-sm font-semibold"
        >
          {t.pricing.tryAgain || 'Try Again'}
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={startCheckout}
      disabled={status === 'processing'}
      className="w-full py-3 btn-primary rounded-xl text-sm font-semibold disabled:opacity-60"
    >
      {status === 'processing'
        ? (t.pricing.paymentProcessing || 'Processing...')
        : `${props.platform === 'creem' ? 'Creem' : 'Stripe'} Checkout`}
    </button>
  )
}

