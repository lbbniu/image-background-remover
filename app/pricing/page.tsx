'use client'

import { useState } from 'react'
import Link from 'next/link'

const plans = [
  {
    id: 'free',
    name: 'Free',
    description: 'Perfect for trying out ClearCut',
    priceMonthly: 0,
    priceYearly: 0,
    credits: '10 / month',
    highlight: false,
    features: [
      { text: '10 credits per month', included: true },
      { text: '3 bonus credits on signup', included: true },
      { text: 'Standard quality output', included: true },
      { text: 'Max 10MB file size', included: true },
      { text: 'HD quality output', included: false },
      { text: 'Batch processing', included: false },
      { text: 'Processing history', included: false },
      { text: 'API access', included: false },
    ],
    cta: 'Get Started Free',
    ctaLink: '/api/auth/login',
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'For designers & content creators',
    priceMonthly: 9.9,
    priceYearly: 79,
    credits: '200 / month',
    highlight: true,
    badge: 'Most Popular',
    features: [
      { text: '200 credits per month', included: true },
      { text: 'HD quality output', included: true },
      { text: 'Max 25MB file size', included: true },
      { text: 'Batch processing (10 images)', included: true },
      { text: 'Priority processing', included: true },
      { text: '30-day history', included: true },
      { text: 'API access', included: false },
      { text: 'Custom integration', included: false },
    ],
    cta: 'Upgrade to Pro',
    ctaLink: '#',
  },
  {
    id: 'business',
    name: 'Business',
    description: 'For teams & high-volume needs',
    priceMonthly: 29.9,
    priceYearly: 239,
    credits: '1,000 / month',
    highlight: false,
    features: [
      { text: '1,000 credits per month', included: true },
      { text: 'HD quality output', included: true },
      { text: 'Max 25MB file size', included: true },
      { text: 'Batch processing (50 images)', included: true },
      { text: 'Priority processing', included: true },
      { text: '90-day history', included: true },
      { text: 'API access', included: true },
      { text: 'Priority support', included: true },
    ],
    cta: 'Go Business',
    ctaLink: '#',
  },
]

const creditPacks = [
  { credits: 50, price: 4.99, perCredit: '0.10' },
  { credits: 200, price: 14.99, perCredit: '0.075', badge: 'Best Value' },
  { credits: 500, price: 29.99, perCredit: '0.06' },
]

const faqs = [
  {
    q: 'What is a credit?',
    a: 'One credit = one background removal. Each time you process an image, one credit is used. If processing fails, the credit is automatically refunded.',
  },
  {
    q: 'What happens when I run out of credits?',
    a: 'You can wait for your monthly credits to reset, purchase a Credit Pack for instant top-up, or upgrade to a higher plan for more monthly credits.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes! You can cancel your subscription at any time. You\'ll keep your remaining credits until the end of the billing period.',
  },
  {
    q: 'Do unused credits roll over?',
    a: 'Monthly credits reset each billing cycle and do not roll over. However, Credit Pack credits never expire.',
  },
  {
    q: 'What payment methods do you accept?',
    a: 'We accept all major credit cards, PayPal, and Google Pay through our secure payment processor.',
  },
  {
    q: 'Is there a refund policy?',
    a: 'Yes, we offer a 7-day money-back guarantee on all subscription plans. Credit Pack purchases are non-refundable.',
  },
  {
    q: 'What\'s the difference between Standard and HD quality?',
    a: 'Standard quality outputs images at up to 2048px resolution. HD quality preserves the original resolution with enhanced edge detection, especially around hair and transparent objects.',
  },
  {
    q: 'Do you offer custom enterprise plans?',
    a: 'Yes! Contact us at support@clearcut.ai for custom volume pricing, SLA agreements, and dedicated support.',
  },
]

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

export default function PricingPage() {
  const [annual, setAnnual] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="max-w-6xl mx-auto">

        {/* Navigation */}
        <nav className="flex items-center justify-between mb-16">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">ClearCut</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/" className="text-sm text-gray-400 hover:text-white transition-colors">Home</Link>
            <Link href="/pricing" className="text-sm text-white font-medium">Pricing</Link>
          </div>
        </nav>

        {/* Hero */}
        <header className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
            Simple, transparent pricing
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            Start free. Upgrade when you need more. No hidden fees.
          </p>
        </header>

        {/* Billing Toggle */}
        <div className="flex items-center justify-center gap-4 mb-12">
          <span className={`text-sm ${!annual ? 'text-white font-medium' : 'text-gray-500'}`}>Monthly</span>
          <button
            onClick={() => setAnnual(!annual)}
            className={`relative w-14 h-7 rounded-full transition-colors ${annual ? 'bg-indigo-600' : 'bg-gray-700'}`}
          >
            <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white transition-transform ${annual ? 'translate-x-7' : 'translate-x-0.5'}`} />
          </button>
          <span className={`text-sm ${annual ? 'text-white font-medium' : 'text-gray-500'}`}>
            Yearly
            <span className="ml-1.5 px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-xs rounded-full">Save 33%</span>
          </span>
        </div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-16">
          {plans.map((plan) => {
            const price = annual ? plan.priceYearly : plan.priceMonthly
            const period = annual ? '/year' : '/month'

            return (
              <div
                key={plan.id}
                className={`relative glass-card rounded-2xl p-8 ${
                  plan.highlight
                    ? 'border-indigo-500/50 glow-border'
                    : ''
                }`}
              >
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full text-xs font-semibold text-white">
                    {plan.badge}
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="text-xl font-bold text-white mb-1">{plan.name}</h3>
                  <p className="text-sm text-gray-400">{plan.description}</p>
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
                    {plan.credits} credits
                  </p>
                </div>

                <a
                  href={plan.ctaLink}
                  className={`block w-full text-center py-3 rounded-xl font-semibold transition-all mb-8 ${
                    plan.highlight
                      ? 'btn-primary'
                      : 'btn-secondary'
                  }`}
                >
                  {plan.cta}
                </a>

                <ul className="space-y-3">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-3">
                      {feature.included ? <CheckIcon /> : <XIcon />}
                      <span className={`text-sm ${feature.included ? 'text-gray-300' : 'text-gray-600'}`}>
                        {feature.text}
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
            <h2 className="text-2xl font-bold text-white mb-2">Need more credits?</h2>
            <p className="text-gray-400">Buy a Credit Pack — no subscription required. Credits never expire.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-4 max-w-3xl mx-auto">
            {creditPacks.map((pack) => (
              <div key={pack.credits} className="relative glass-card rounded-xl p-6 text-center hover:border-indigo-500/30 transition-colors">
                {pack.badge && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-emerald-500/20 text-emerald-400 text-xs font-semibold rounded-full border border-emerald-500/30">
                    {pack.badge}
                  </div>
                )}
                <p className="text-3xl font-bold text-white mb-1">{pack.credits}</p>
                <p className="text-sm text-gray-400 mb-3">credits</p>
                <p className="text-2xl font-bold text-white mb-1">${pack.price}</p>
                <p className="text-xs text-gray-500 mb-4">${pack.perCredit} per credit</p>
                <button className="w-full py-2 btn-secondary rounded-lg text-sm font-medium">
                  Buy Now
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="mb-20 max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-white text-center mb-8">
            Frequently Asked Questions
          </h2>
          <div className="space-y-3">
            {faqs.map((faq, i) => (
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
            Ready to remove backgrounds like a pro?
          </h2>
          <p className="text-gray-400 mb-8 max-w-xl mx-auto">
            Join thousands of designers and creators who trust ClearCut for their image editing needs.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/" className="btn-primary px-8 py-4 rounded-xl font-semibold text-center">
              Start Free — No Credit Card
            </Link>
            <a href="#" className="btn-secondary px-8 py-4 rounded-xl font-semibold text-center">
              View Demo
            </a>
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center text-gray-500 text-sm pb-8">
          <p>© 2026 ClearCut AI. All rights reserved.</p>
          <p className="mt-2 flex items-center justify-center gap-4">
            <a href="#" className="hover:text-gray-300 transition-colors">Terms</a>
            <a href="#" className="hover:text-gray-300 transition-colors">Privacy</a>
            <a href="mailto:support@clearcut.ai" className="hover:text-gray-300 transition-colors">Contact</a>
          </p>
        </footer>
      </div>
    </div>
  )
}
