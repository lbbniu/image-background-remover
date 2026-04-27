'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import Navbar from '../components/Navbar'
import { useI18n } from '../i18n'

interface User {
  id: string
  name: string
  email: string
  avatar: string
}

interface QuotaInfo {
  plan: {
    id: string
    name: string
    priceMonthly: number
    creditsMonthly: number
    features: string[]
  }
  credits: {
    remaining: number
    monthlyRemaining: number
    purchasedRemaining: number
    giftedRemaining: number
    totalUsed: number
  }
}

function formatMonthlyPrice(amountCents?: number) {
  if (!amountCents) return 'Free'
  return `$${(amountCents / 100).toFixed(2).replace(/\.00$/, '')}`
}

export default function ProfilePage() {
  const { t } = useI18n()
  const [user, setUser] = useState<User | null>(null)
  const [quota, setQuota] = useState<QuotaInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [quotaLoading, setQuotaLoading] = useState(true)

  useEffect(() => {
    // 获取用户信息
    fetch('/api/auth/session')
      .then(res => res.json())
      .then(data => {
        if (data.authenticated) {
          setUser(data.user)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))

    // 获取配额信息
    fetch('/api/me/credits')
      .then(res => {
        if (res.status === 401) return null
        if (!res.ok) throw new Error('Failed')
        return res.json()
      })
      .then(data => {
        if (data) setQuota(data)
      })
      .catch(() => {})
      .finally(() => setQuotaLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="loading-ring" />
      </div>
    )
  }

  // Not logged in — show login prompt
  if (!user) {
    return (
      <div className="min-h-screen py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <Navbar activePage="profile" />
          <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 200px)' }}>
            <div className="glass-card rounded-3xl p-12 text-center max-w-md glow-border">
              <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center border border-indigo-500/30">
                <svg className="w-10 h-10 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <p className="text-gray-400 text-lg mb-8">{t.profile.loginRequired}</p>
              <a
                href="/api/oauth/google/authorization"
                className="inline-flex items-center gap-3 glass-card rounded-full px-8 py-3.5 hover:border-indigo-500/30 transition-colors cursor-pointer"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" width={20} height={20}>
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                <span className="text-sm font-medium text-gray-300">{t.nav.login}</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Logged in — show profile
  const monthlyTotal = quota?.plan?.creditsMonthly || 10
  const monthlyRemaining = quota?.credits?.monthlyRemaining || 0
  const monthlyUsed = Math.max(0, monthlyTotal - monthlyRemaining)
  const monthlyPercent = monthlyTotal > 0 ? Math.min(100, Math.round((monthlyUsed / monthlyTotal) * 100)) : 0
  const availableTotal = quota?.credits?.remaining ?? 0

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="max-w-4xl mx-auto">

        {/* Navigation */}
        <Navbar activePage="profile" />

        {/* User Info Card */}
        <div className="glass-card rounded-3xl p-8 glow-border mb-8">
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <Image
              src={user.avatar}
              alt={user.name}
              width={80}
              height={80}
              unoptimized
              className="rounded-2xl border-2 border-indigo-500/30 shadow-lg shadow-indigo-500/20"
              referrerPolicy="no-referrer"
            />
            <div className="text-center sm:text-left flex-1">
              <h1 className="text-2xl font-bold text-white mb-1">{user.name}</h1>
              <p className="text-gray-400">{user.email}</p>
              <div className="flex items-center gap-2 mt-2 justify-center sm:justify-start">
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-gradient-to-r from-indigo-500/20 to-purple-500/20 text-indigo-300 border border-indigo-500/30">
                  {quota?.plan?.name || 'Free'} Plan
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                await fetch('/api/auth/session', { method: 'DELETE' })
                window.location.href = '/'
              }}
              className="btn-secondary px-5 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              {t.nav.logout}
            </button>
          </div>
        </div>

        {/* Quota Overview */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">

          {/* Credits Card */}
          <div className="glass-card rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">{t.profile.quotaTitle}</h2>
              <span className="text-sm text-cyan-400 font-medium">
                {quotaLoading ? '...' : `${t.profile.totalAvailable} ${availableTotal} ${t.profile.times}`}
              </span>
            </div>

            {quotaLoading ? (
              <div className="space-y-3 animate-pulse">
                <div className="h-3 bg-gray-700 rounded-full" />
                <div className="h-3 bg-gray-700 rounded-full w-2/3" />
              </div>
            ) : quota ? (
              <>
                <div className="mb-5 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
                  <p className="text-sm text-cyan-200/80">{t.profile.totalAvailable}</p>
                  <p className="mt-1 text-4xl font-bold text-white">
                    {availableTotal}
                    <span className="ml-2 text-sm font-medium text-gray-400">{t.profile.times}</span>
                  </p>
                </div>

                {/* Monthly quota progress */}
                <div className="mb-4">
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="text-gray-400">{t.profile.monthlyUsed}</span>
                    <span className="text-gray-300">{monthlyUsed} / {monthlyTotal}</span>
                  </div>
                  <div className="h-2.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${monthlyPercent}%`,
                        background: monthlyPercent > 80
                          ? 'linear-gradient(90deg, #ef4444, #f97316)'
                          : 'linear-gradient(90deg, #6366f1, #8b5cf6, #06b6d4)',
                      }}
                    />
                  </div>
                </div>

                {/* Breakdown */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-indigo-500" />
                      {t.profile.monthlyRemaining}
                    </span>
                    <span className="text-gray-300">{monthlyRemaining} {t.profile.times}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      {t.profile.purchasedRemaining || 'Purchased Credits'}
                    </span>
                    <span className="text-gray-300">{quota.credits.purchasedRemaining} {t.profile.times}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      {t.profile.bonusRemaining}
                    </span>
                    <span className="text-gray-300">{quota.credits.giftedRemaining} {t.profile.times}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm pt-2 border-t border-gray-800">
                    <span className="text-gray-500">{t.profile.totalUsed}</span>
                    <span className="text-gray-300">{quota.credits.totalUsed} {t.profile.times}</span>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-gray-500 text-sm">{t.profile.unavailable}</p>
            )}
          </div>

          {/* Plan Card */}
          <div className="glass-card rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">{t.profile.planTitle}</h2>
            </div>

            <div className="mb-6">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-3xl font-bold text-white">
                  {formatMonthlyPrice(quota?.plan?.priceMonthly)}
                </span>
                {(quota?.plan?.priceMonthly || 0) > 0 && (
                  <span className="text-gray-500 text-sm">/month</span>
                )}
              </div>
              <p className="text-sm text-gray-400">
                {monthlyTotal} {t.profile.creditsPerMonth}
              </p>
            </div>

            <div className="space-y-2 mb-6">
              {[
                { text: `${monthlyTotal} ${t.profile.creditsPerMonth}`, included: true },
                { text: t.profile.hdOutput, included: (quota?.plan?.id || 'free') !== 'free' },
                { text: t.profile.batchProcess, included: (quota?.plan?.id || 'free') !== 'free' },
                { text: t.profile.apiAccess, included: quota?.plan?.id === 'business' },
              ].map((feature, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  {feature.included ? (
                    <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-gray-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                  <span className={feature.included ? 'text-gray-300' : 'text-gray-600'}>
                    {feature.text}
                  </span>
                </div>
              ))}
            </div>

            <Link
              href="/pricing"
              className="block w-full text-center btn-primary py-3 rounded-xl font-semibold"
            >
              {(quota?.plan?.id || 'free') === 'free' ? t.profile.upgrade : t.profile.manage}
            </Link>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="glass-card rounded-2xl p-6 mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">{t.profile.actionsTitle}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Link href="/" className="glass-card rounded-xl p-4 text-center hover:border-indigo-500/30 transition-colors group">
              <div className="text-2xl mb-2">✂️</div>
              <p className="text-sm font-medium text-gray-300 group-hover:text-white transition-colors">{t.profile.startCut}</p>
            </Link>
            <Link href="/pricing" className="glass-card rounded-xl p-4 text-center hover:border-indigo-500/30 transition-colors group">
              <div className="text-2xl mb-2">💎</div>
              <p className="text-sm font-medium text-gray-300 group-hover:text-white transition-colors">{t.profile.buyCredits}</p>
            </Link>
            <a href="#" className="glass-card rounded-xl p-4 text-center hover:border-indigo-500/30 transition-colors group opacity-50 cursor-not-allowed">
              <div className="text-2xl mb-2">📋</div>
              <p className="text-sm font-medium text-gray-300">{t.profile.historyLabel}</p>
              <p className="text-xs text-gray-600 mt-1">{t.profile.comingSoon}</p>
            </a>
            <a href="#" className="glass-card rounded-xl p-4 text-center hover:border-indigo-500/30 transition-colors group opacity-50 cursor-not-allowed">
              <div className="text-2xl mb-2">🔑</div>
              <p className="text-sm font-medium text-gray-300">{t.profile.apiKeyLabel}</p>
              <p className="text-xs text-gray-600 mt-1">{t.profile.comingSoon}</p>
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
