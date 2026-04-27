'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Navbar from '../components/Navbar'
import CreditPackCheckout from '../components/CreditPackCheckout'
import SubscriptionCheckout from '../components/SubscriptionCheckout'
import PayPalProvider from '../components/PayPalProvider'
import { useI18n } from '../i18n'

type SubscriptionPriceKey = 'pro_monthly' | 'pro_yearly' | 'biz_monthly' | 'biz_yearly'
type CreditPack = {
  id: string
  credits: number
  price: number
  perCredit: string
  badgeKey?: 'packBest'
}
type CheckoutState =
  | { type: 'subscription'; planId: string; planName: string }
  | { type: 'credit'; packId: string; credits: number; price: number }
  | null

const emptySubscriptionPrices: Record<SubscriptionPriceKey, string> = {
  pro_monthly: '',
  pro_yearly: '',
  biz_monthly: '',
  biz_yearly: '',
}

const plansData = [
  {
    id: 'free',
    nameKey: 'freeName' as const,
    descKey: 'freeDesc' as const,
    priceMonthly: 0,
    priceYearly: 0,
    credits: '10',
    highlight: false,
    features: [
      { textKey: 'credits10', included: true },
      { textKey: 'signupBonus', included: true },
      { textKey: 'standardQuality', included: true },
      { textKey: 'maxFile10', included: true },
      { textKey: 'hdQuality', included: false },
      { textKey: 'batch', included: false },
      { textKey: 'history', included: false },
      { textKey: 'api', included: false },
    ],
    ctaKey: 'freeCta' as const,
    ctaLink: '/api/oauth/google/authorization',
    subscriptionKey: null as null,
  },
  {
    id: 'pro',
    nameKey: 'proName' as const,
    descKey: 'proDesc' as const,
    priceMonthly: 9.9,
    priceYearly: 79,
    credits: '200',
    highlight: true,
    badgeKey: 'proBadge' as const,
    features: [
      { textKey: 'credits200', included: true },
      { textKey: 'hdCost', included: true },
      { textKey: 'hdQuality', included: true },
      { textKey: 'maxFile25', included: true },
      { textKey: 'batch10', included: true },
      { textKey: 'priority', included: true },
      { textKey: 'history30', included: true },
      { textKey: 'api', included: false },
      { textKey: 'custom', included: false },
    ],
    ctaKey: 'proCta' as const,
    ctaLink: '#',
    subscriptionKey: { monthly: 'pro_monthly' as const, yearly: 'pro_yearly' as const },
  },
  {
    id: 'business',
    nameKey: 'bizName' as const,
    descKey: 'bizDesc' as const,
    priceMonthly: 29.9,
    priceYearly: 239,
    credits: '1,000',
    highlight: false,
    features: [
      { textKey: 'credits1000', included: true },
      { textKey: 'hdCost', included: true },
      { textKey: 'hdQuality', included: true },
      { textKey: 'maxFile25', included: true },
      { textKey: 'batch50', included: true },
      { textKey: 'priority', included: true },
      { textKey: 'history90', included: true },
      { textKey: 'api', included: true },
      { textKey: 'support', included: true },
    ],
    ctaKey: 'bizCta' as const,
    ctaLink: '#',
    subscriptionKey: { monthly: 'biz_monthly' as const, yearly: 'biz_yearly' as const },
  },
]

const defaultCreditPacks: CreditPack[] = [
  { id: '50', credits: 50, price: 4.99, perCredit: '0.10' },
  { id: '200', credits: 200, price: 14.99, perCredit: '0.075', badgeKey: 'packBest' as const },
  { id: '500', credits: 500, price: 29.99, perCredit: '0.06' },
]

function toCreditPack(pack: {
  id: string
  credits: number
  amountCents: number
  badge?: string | null
}): CreditPack {
  const price = pack.amountCents / 100
  return {
    id: pack.id,
    credits: pack.credits,
    price,
    perCredit: (price / pack.credits).toFixed(3).replace(/0+$/, '').replace(/\.$/, ''),
    badgeKey: pack.badge === 'best' ? 'packBest' : undefined,
  }
}

// Feature text mapping with i18n support
function getFeatureText(textKey: string, t: ReturnType<typeof useI18n>['t']): string {
  const map: Record<string, string> = {
    credits10: `10 ${t.pricing.creditsMonth}`,
    credits200: `200 ${t.pricing.creditsMonth}`,
    credits1000: `1,000 ${t.pricing.creditsMonth}`,
    hdCost: t.pricing.hdCost,
    signupBonus: t.pricing.signupBonus,
    standardQuality: t.pricing.standardQuality,
    maxFile10: `${t.pricing.maxFile} 10MB`,
    maxFile25: `${t.pricing.maxFile} 25MB`,
    hdQuality: t.pricing.hdQuality,
    batch: t.pricing.batch,
    batch10: `${t.pricing.batch} (10)`,
    batch50: `${t.pricing.batch} (50)`,
    priority: t.pricing.priority,
    history: `${t.pricing.history}`,
    history30: `30${t.pricing.history}`,
    history90: `90${t.pricing.history}`,
    api: t.pricing.api,
    custom: t.pricing.custom,
    support: t.pricing.support,
  }
  return map[textKey] || textKey
}

function CheckIcon() {
  return (
    <svg className="w-5 h-5 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg className="w-5 h-5 text-gray-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

// Toast notification component
function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000)
    return () => clearTimeout(timer)
  }, [onClose])

  return (
    <div className={`fixed top-6 right-6 z-50 px-6 py-4 rounded-xl shadow-lg backdrop-blur-sm border transition-all ${
      type === 'success'
        ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
        : 'bg-red-500/20 border-red-500/30 text-red-400'
    }`}>
      <div className="flex items-center gap-3">
        <span className="text-lg">{type === 'success' ? '✓' : '✗'}</span>
        <span className="text-sm font-medium">{message}</span>
        <button onClick={onClose} className="ml-2 text-gray-400 hover:text-white">×</button>
      </div>
    </div>
  )
}

export default function PricingPage() {
  const { t } = useI18n()
  const [annual, setAnnual] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null)
  const [subscriptionPrices, setSubscriptionPrices] = useState<Record<SubscriptionPriceKey, string>>(emptySubscriptionPrices)
  const [creditPacks, setCreditPacks] = useState<CreditPack[]>(defaultCreditPacks)
  const [pricesLoaded, setPricesLoaded] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [checkout, setCheckout] = useState<CheckoutState>(null)

  // Check login status
  useEffect(() => {
    fetch('/api/auth/session')
      .then(res => res.json())
      .then(data => setIsLoggedIn(!!data.user))
      .catch(() => setIsLoggedIn(false))

    fetch('/api/plan-prices?platform=paypal')
      .then(res => res.json())
      .then(data => {
        if (!data.success) return
        const next = { ...emptySubscriptionPrices }
        for (const price of data.prices as Array<{ id: string; planId: string; interval: string; externalId: string }>) {
          const key = `${price.planId}_${price.interval === 'year' ? 'yearly' : 'monthly'}`
          if (key in next) next[key as SubscriptionPriceKey] = price.externalId
        }
        setSubscriptionPrices(next)
      })
      .catch(() => {})
      .finally(() => setPricesLoaded(true))

    fetch('/api/credit-packages?platform=paypal')
      .then(res => res.json())
      .then(data => {
        if (!data.success || !Array.isArray(data.packages)) return
        setCreditPacks(data.packages.map(toCreditPack))
      })
      .catch(() => {})
  }, [])

  const handleLoginRequired = () => {
    window.location.href = '/api/oauth/google/authorization'
  }

  const handleCreditPackSuccess = (credits: number) => {
    setCheckout(null)
    setToast({
      message: `${t.pricing.paymentSuccess || 'Payment successful!'} +${credits} ${t.pricing.packCredits}`,
      type: 'success',
    })
  }

  const handleSubscriptionSuccess = (plan: string) => {
    setCheckout(null)
    setToast({
      message: `${t.pricing.subscriptionSuccess || 'Subscription activated!'} — ${plan}`,
      type: 'success',
    })
  }

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="max-w-6xl mx-auto">

        {/* Toast */}
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

        {checkout && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <button
              type="button"
              aria-label="Close checkout"
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setCheckout(null)}
            />
            <div className="relative w-full max-w-md glass-card rounded-3xl p-6 glow-border">
              <div className="flex items-start justify-between gap-4 mb-5">
                <div>
                  <h2 className="text-xl font-bold text-white">
                    {checkout.type === 'subscription'
                      ? checkout.planName
                      : `${checkout.credits} ${t.pricing.packCredits}`}
                  </h2>
                  <p className="text-sm text-gray-400 mt-1">
                    {checkout.type === 'subscription'
                      ? t.pricing.subscriptionCheckout || 'Complete your subscription with PayPal'
                      : `$${checkout.price} · ${t.pricing.packBuy}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCheckout(null)}
                  className="w-9 h-9 rounded-full bg-white/10 text-gray-400 hover:text-white hover:bg-white/15 transition-colors"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              <PayPalProvider
                key={checkout.type === 'subscription' ? `sub-${checkout.planId}` : `credit-${checkout.packId}`}
                intent={checkout.type === 'subscription' ? 'subscription' : 'capture'}
              >
                {checkout.type === 'subscription' ? (
                  <SubscriptionCheckout
                    planId={checkout.planId}
                    planName={checkout.planName}
                    onSuccess={handleSubscriptionSuccess}
                  />
                ) : (
                  <CreditPackCheckout
                    packId={checkout.packId}
                    credits={checkout.credits}
                    price={checkout.price}
                    onSuccess={handleCreditPackSuccess}
                  />
                )}
              </PayPalProvider>
            </div>
          </div>
        )}

        {/* Navigation */}
        <Navbar activePage="pricing" />

        {/* Hero */}
        <header className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
            {t.pricing.title}
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            {t.pricing.subtitle}
          </p>
        </header>

        {/* Billing Toggle */}
        <div className="flex items-center justify-center gap-4 mb-12">
          <span className={`text-sm ${!annual ? 'text-white font-medium' : 'text-gray-500'}`}>{t.pricing.monthly}</span>
          <button
            onClick={() => setAnnual(!annual)}
            className={`relative w-14 h-7 rounded-full transition-colors ${annual ? 'bg-indigo-600' : 'bg-gray-700'}`}
          >
            <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white transition-transform ${annual ? 'translate-x-7' : 'translate-x-0.5'}`} />
          </button>
          <span className={`text-sm ${annual ? 'text-white font-medium' : 'text-gray-500'}`}>
            {t.pricing.yearly}
            <span className="ml-1.5 px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-xs rounded-full">{t.pricing.save}</span>
          </span>
        </div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-16">
          {plansData.map((plan) => {
            const price = annual ? plan.priceYearly : plan.priceMonthly
            const period = annual ? '/year' : '/month'
            const subscriptionPlanKey = plan.subscriptionKey
              ? (annual ? plan.subscriptionKey.yearly : plan.subscriptionKey.monthly)
              : null
            const subscriptionPlanId = subscriptionPlanKey
              ? subscriptionPrices[subscriptionPlanKey]
              : null

            return (
              <div
                key={plan.id}
                className={`relative glass-card rounded-2xl p-8 ${
                  plan.highlight
                    ? 'border-indigo-500/50 glow-border'
                    : ''
                }`}
              >
                {plan.badgeKey && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full text-xs font-semibold text-white">
                    {t.pricing[plan.badgeKey]}
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="text-xl font-bold text-white mb-1">{t.pricing[plan.nameKey]}</h3>
                  <p className="text-sm text-gray-400">{t.pricing[plan.descKey]}</p>
                </div>

                <div className="mb-6">
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-white">
                      {price === 0 ? '$0' : `$${price}`}
                    </span>
                    {price > 0 && (
                      <span className="text-gray-500 text-sm">{period}</span>
                    )}
                  </div>
                  {annual && plan.priceMonthly > 0 && (
                    <p className="text-sm text-gray-500 mt-1 line-through">
                      ${(plan.priceMonthly * 12).toFixed(0)}/year
                    </p>
                  )}
                  <p className="text-sm text-cyan-400 mt-2">
                    {plan.credits} {t.pricing.creditsMonth}
                  </p>
                  {price > 0 && (
                    <p className="text-xs text-gray-500 mt-1">
                      ≈ {Math.floor(Number(plan.credits.replace(',', '')) / 10)} {t.pricing.hdRemovalEstimate}
                    </p>
                  )}
                </div>

                {/* CTA: Free plan → login link, paid plans → subscription */}
                {plan.id === 'free' ? (
                  <a
                    href={plan.ctaLink}
                    className="block w-full text-center py-3 rounded-xl font-semibold transition-all mb-8 btn-secondary"
                  >
                    {t.pricing[plan.ctaKey]}
                  </a>
                ) : isLoggedIn === null || !pricesLoaded ? (
                  <button
                    disabled
                    className="block w-full text-center py-3 rounded-xl font-semibold transition-all mb-8 btn-secondary opacity-50 cursor-not-allowed"
                  >
                    {t.pricing.loading || 'Loading...'}
                  </button>
                ) : isLoggedIn === false ? (
                  <button
                    onClick={handleLoginRequired}
                    className={`block w-full text-center py-3 rounded-xl font-semibold transition-all mb-8 ${
                      plan.highlight ? 'btn-primary' : 'btn-secondary'
                    }`}
                  >
                    {t.pricing.loginToBuy || t.pricing[plan.ctaKey]}
                  </button>
                ) : subscriptionPlanId ? (
                  <button
                    onClick={() => setCheckout({
                      type: 'subscription',
                      planId: subscriptionPlanId,
                      planName: t.pricing[plan.nameKey],
                    })}
                    className={`block w-full text-center py-3 rounded-xl font-semibold transition-all mb-8 ${
                      plan.highlight ? 'btn-primary' : 'btn-secondary'
                    }`}
                  >
                    {t.pricing[plan.ctaKey]}
                  </button>
                ) : (
                  <button
                    disabled
                    className="block w-full text-center py-3 rounded-xl font-semibold transition-all mb-8 btn-secondary opacity-50 cursor-not-allowed"
                  >
                    {t.pricing.paymentUnavailable || t.pricing.comingSoon || 'Payment unavailable'}
                  </button>
                )}

                <ul className="space-y-3">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-3">
                      {feature.included ? <CheckIcon /> : <XIcon />}
                      <span className={`text-sm ${feature.included ? 'text-gray-300' : 'text-gray-600'}`}>
                        {getFeatureText(feature.textKey, t)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>

        {/* Credit Packs */}
        <div className="mb-20">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-white mb-2">{t.pricing.packTitle}</h2>
            <p className="text-gray-400">{t.pricing.packSubtitle}</p>
          </div>
          <div className="grid md:grid-cols-3 gap-4 max-w-3xl mx-auto">
            {creditPacks.map((pack) => (
              <div key={pack.credits} className="relative glass-card rounded-xl p-6 text-center hover:border-indigo-500/30 transition-colors">
                {pack.badgeKey && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-emerald-500/20 text-emerald-400 text-xs font-semibold rounded-full border border-emerald-500/30">
                    {t.pricing[pack.badgeKey]}
                  </div>
                )}
                <p className="text-3xl font-bold text-white mb-1">{pack.credits}</p>
                <p className="text-sm text-gray-400 mb-3">{t.pricing.packCredits}</p>
                <p className="text-2xl font-bold text-white mb-1">${pack.price}</p>
                <p className="text-xs text-gray-500 mb-4">${pack.perCredit} {t.pricing.packPer}</p>

                {/* PayPal checkout or login button */}
                {isLoggedIn === false ? (
                  <button
                    onClick={handleLoginRequired}
                    className="w-full py-2 btn-secondary rounded-lg text-sm font-medium"
                  >
                    {t.pricing.loginToBuy || t.pricing.packBuy}
                  </button>
                ) : isLoggedIn ? (
                  <button
                    onClick={() => setCheckout({
                      type: 'credit',
                      packId: pack.id,
                      credits: pack.credits,
                      price: pack.price,
                    })}
                    className="w-full py-2 btn-secondary rounded-lg text-sm font-medium"
                  >
                    {t.pricing.packBuy}
                  </button>
                ) : (
                  <button className="w-full py-2 btn-secondary rounded-lg text-sm font-medium opacity-50" disabled>
                    {t.pricing.packBuy}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="mb-20 max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-white text-center mb-8">
            {t.pricing.faqTitle}
          </h2>
          <div className="space-y-3">
            {t.pricing.faq.map((faq, i) => (
              <div key={i} className="glass-card rounded-xl overflow-hidden">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between p-5 text-left"
                >
                  <span className="font-medium text-white pr-4">{faq.q}</span>
                  <svg
                    className={`w-5 h-5 text-gray-400 shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-5">
                    <p className="text-gray-400 text-sm leading-relaxed">{faq.a}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="text-center mb-16 glass-card rounded-3xl p-12 glow-border">
          <h2 className="text-3xl font-bold text-white mb-4">
            {t.pricing.ctaTitle}
          </h2>
          <p className="text-gray-400 mb-8 max-w-xl mx-auto">
            {t.pricing.ctaSubtitle}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/" className="btn-primary px-8 py-4 rounded-xl font-semibold text-center">
              {t.pricing.ctaStart}
            </Link>
            <a href="#" className="btn-secondary px-8 py-4 rounded-xl font-semibold text-center">
              {t.pricing.ctaDemo}
            </a>
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center text-gray-500 text-sm pb-8">
          <p>{t.footer.copyright}</p>
          <p className="mt-2 flex items-center justify-center gap-4">
            <a href="#" className="hover:text-gray-300 transition-colors">{t.footer.terms}</a>
            <a href="#" className="hover:text-gray-300 transition-colors">{t.footer.privacy}</a>
            <a href="mailto:support@clearcut.ai" className="hover:text-gray-300 transition-colors">{t.footer.contact}</a>
          </p>
        </footer>
      </div>
    </div>
  )
}
