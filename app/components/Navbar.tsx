'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useI18n } from '../i18n'

interface NavbarProps {
  activePage: 'home' | 'pricing' | 'profile'
}

export default function Navbar({ activePage }: NavbarProps) {
  const { locale, t, setLocale } = useI18n()
  const [user, setUser] = useState<{ id: string; name: string; email: string; avatar: string } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.json())
      .then(data => {
        if (data.authenticated) setUser(data.user)
      })
      .catch(() => {})
  }, [])

  // Close menu on route change (clicking a link)
  const closeMenu = () => setMenuOpen(false)

  const navLinks: { key: 'home' | 'pricing'; label: string; href: string }[] = [
    { key: 'home', label: t.nav.home, href: '/' },
    { key: 'pricing', label: t.nav.pricing, href: '/pricing' },
  ]

  const GoogleIcon = () => (
    <svg className="w-5 h-5" viewBox="0 0 24 24" width={20} height={20}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  )

  const LanguageButton = ({ className }: { className?: string }) => (
    <button
      onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 transition-colors ${className || ''}`}
    >
      {locale === 'zh' ? 'EN' : '中'}
    </button>
  )

  return (
    <nav className="relative mb-12">
      {/* Main bar */}
      <div className="flex items-center justify-between">
        {/* Left: Logo */}
        <Link href="/" className="flex items-center gap-2" onClick={closeMenu}>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
          </div>
          <span className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">ClearCut</span>
        </Link>

        {/* Center: Nav Links (desktop only) */}
        <div className="hidden md:flex items-center gap-4">
          {navLinks.map(link => (
            <Link
              key={link.key}
              href={link.href}
              className={`text-sm transition-colors ${
                activePage === link.key
                  ? 'text-white font-medium'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Right: Desktop actions + Mobile hamburger */}
        <div className="flex items-center gap-3">
          {/* Desktop: Language + User (hidden on mobile) */}
          <div className="hidden md:flex items-center gap-3">
            <LanguageButton />

            {user ? (
              <Link
                href="/profile"
                className="flex items-center gap-3 glass-card rounded-full px-4 py-2 hover:border-indigo-500/30 transition-colors cursor-pointer"
              >
                <img
                  src={user.avatar}
                  alt={user.name}
                  className="w-8 h-8 rounded-full border border-indigo-500/30"
                  referrerPolicy="no-referrer"
                />
                <span className="text-sm text-gray-300">{user.name}</span>
                <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ) : (
              <a
                href="/api/auth/login"
                className="flex items-center gap-2 glass-card rounded-full px-5 py-2.5 hover:border-indigo-500/30 transition-colors cursor-pointer"
              >
                <GoogleIcon />
                <span className="text-sm text-gray-300">{t.nav.login}</span>
              </a>
            )}
          </div>

          {/* Mobile: Hamburger button */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="md:hidden flex items-center justify-center w-10 h-10 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Menu"
          >
            {menuOpen ? (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 mt-3 glass-card rounded-2xl p-4 z-50 border border-white/10">
          {/* Nav links */}
          <div className="flex flex-col gap-1 mb-4">
            {navLinks.map(link => (
              <Link
                key={link.key}
                href={link.href}
                onClick={closeMenu}
                className={`px-4 py-3 rounded-xl text-sm transition-colors ${
                  activePage === link.key
                    ? 'text-white font-medium bg-white/5'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Divider */}
          <div className="border-t border-white/10 mb-4" />

          {/* Language + User */}
          <div className="flex items-center justify-between px-4">
            <LanguageButton />

            {user ? (
              <Link
                href="/profile"
                onClick={closeMenu}
                className="flex items-center gap-3 glass-card rounded-full px-4 py-2 hover:border-indigo-500/30 transition-colors"
              >
                <img
                  src={user.avatar}
                  alt={user.name}
                  className="w-7 h-7 rounded-full border border-indigo-500/30"
                  referrerPolicy="no-referrer"
                />
                <span className="text-sm text-gray-300">{user.name}</span>
              </Link>
            ) : (
              <a
                href="/api/auth/login"
                className="flex items-center gap-2 glass-card rounded-full px-4 py-2 hover:border-indigo-500/30 transition-colors"
              >
                <GoogleIcon />
                <span className="text-sm text-gray-300">{t.nav.login}</span>
              </a>
            )}
          </div>
        </div>
      )}
    </nav>
  )
}
