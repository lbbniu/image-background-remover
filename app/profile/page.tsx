'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

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
    bonusRemaining: number
    totalUsed: number
  }
}

export default function ProfilePage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [quota, setQuota] = useState<QuotaInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [quotaLoading, setQuotaLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // 获取用户信息
    fetch('/api/auth/me')
      .then(res => res.json())
      .then(data => {
        if (data.authenticated) {
          setUser(data.user)
        } else {
          // 未登录，跳转到登录
          router.push('/api/auth/login')
        }
      })
      .catch(() => {
        setError('无法获取用户信息')
      })
      .finally(() => setLoading(false))

    // 获取配额信息
    fetch('/api/user/quota')
      .then(res => {
        if (res.status === 401) return null
        if (!res.ok) throw new Error('Failed')
        return res.json()
      })
      .then(data => {
        if (data) setQuota(data)
      })
      .catch(() => {
        // 配额查询失败不阻塞页面
      })
      .finally(() => setQuotaLoading(false))
  }, [router])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="loading-ring" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="glass-card rounded-2xl p-8 text-center max-w-md">
          <p className="text-gray-400 mb-4">请先登录</p>
          <a href="/api/auth/login" className="btn-primary px-6 py-3 rounded-xl font-semibold inline-block">
            Google 登录
          </a>
        </div>
      </div>
    )
  }

  const monthlyTotal = quota?.plan?.creditsMonthly || 10
  const monthlyUsed = monthlyTotal - (quota?.credits?.monthlyRemaining || 0)
  const monthlyPercent = Math.min(100, Math.round((monthlyUsed / monthlyTotal) * 100))

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="max-w-4xl mx-auto">

        {/* Navigation */}
        <nav className="flex items-center justify-between mb-12">
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
            <Link href="/pricing" className="text-sm text-gray-400 hover:text-white transition-colors">Pricing</Link>
            <span className="text-sm text-white font-medium">Profile</span>
          </div>
        </nav>

        {/* User Info Card */}
        <div className="glass-card rounded-3xl p-8 glow-border mb-8">
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <img
              src={user.avatar}
              alt={user.name}
              className="w-20 h-20 rounded-2xl border-2 border-indigo-500/30 shadow-lg shadow-indigo-500/20"
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
            <a
              href="/api/auth/logout"
              className="btn-secondary px-5 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              登出
            </a>
          </div>
        </div>

        {/* Quota Overview */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">

          {/* Credits Card */}
          <div className="glass-card rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">额度使用</h2>
              <span className="text-sm text-cyan-400 font-medium">
                {quotaLoading ? '...' : `剩余 ${quota?.credits?.remaining ?? '-'} 次`}
              </span>
            </div>

            {quotaLoading ? (
              <div className="space-y-3 animate-pulse">
                <div className="h-3 bg-gray-700 rounded-full" />
                <div className="h-3 bg-gray-700 rounded-full w-2/3" />
              </div>
            ) : quota ? (
              <>
                {/* Monthly quota progress */}
                <div className="mb-4">
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="text-gray-400">月度额度</span>
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
                      月度剩余
                    </span>
                    <span className="text-gray-300">{quota.credits.monthlyRemaining} 次</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      赠送额度
                    </span>
                    <span className="text-gray-300">{quota.credits.bonusRemaining} 次</span>
                  </div>
                  <div className="flex items-center justify-between text-sm pt-2 border-t border-gray-800">
                    <span className="text-gray-500">累计使用</span>
                    <span className="text-gray-300">{quota.credits.totalUsed} 次</span>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-gray-500 text-sm">配额信息暂不可用</p>
            )}
          </div>

          {/* Plan Card */}
          <div className="glass-card rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">当前套餐</h2>
            </div>

            <div className="mb-6">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-3xl font-bold text-white">
                  {quota?.plan?.priceMonthly === 0 ? 'Free' : `$${quota?.plan?.priceMonthly}`}
                </span>
                {(quota?.plan?.priceMonthly || 0) > 0 && (
                  <span className="text-gray-500 text-sm">/month</span>
                )}
              </div>
              <p className="text-sm text-gray-400">
                {monthlyTotal} credits per month
              </p>
            </div>

            <div className="space-y-2 mb-6">
              {[
                { text: `${monthlyTotal} 月度额度`, included: true },
                { text: 'HD 高清输出', included: (quota?.plan?.id || 'free') !== 'free' },
                { text: '批量处理', included: (quota?.plan?.id || 'free') !== 'free' },
                { text: 'API 接口', included: quota?.plan?.id === 'business' },
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
              {(quota?.plan?.id || 'free') === 'free' ? '升级套餐' : '管理套餐'}
            </Link>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="glass-card rounded-2xl p-6 mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">快捷操作</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Link href="/" className="glass-card rounded-xl p-4 text-center hover:border-indigo-500/30 transition-colors group">
              <div className="text-2xl mb-2">✂️</div>
              <p className="text-sm font-medium text-gray-300 group-hover:text-white transition-colors">开始抠图</p>
            </Link>
            <Link href="/pricing" className="glass-card rounded-xl p-4 text-center hover:border-indigo-500/30 transition-colors group">
              <div className="text-2xl mb-2">💎</div>
              <p className="text-sm font-medium text-gray-300 group-hover:text-white transition-colors">购买额度</p>
            </Link>
            <a href="#" className="glass-card rounded-xl p-4 text-center hover:border-indigo-500/30 transition-colors group opacity-50 cursor-not-allowed">
              <div className="text-2xl mb-2">📋</div>
              <p className="text-sm font-medium text-gray-300">处理历史</p>
              <p className="text-xs text-gray-600 mt-1">即将推出</p>
            </a>
            <a href="#" className="glass-card rounded-xl p-4 text-center hover:border-indigo-500/30 transition-colors group opacity-50 cursor-not-allowed">
              <div className="text-2xl mb-2">🔑</div>
              <p className="text-sm font-medium text-gray-300">API 密钥</p>
              <p className="text-xs text-gray-600 mt-1">即将推出</p>
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
