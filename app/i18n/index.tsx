'use client'

import { createContext, useContext, useState, ReactNode } from 'react'
import zh from './zh'
import en from './en'

type Locale = 'zh' | 'en'
type Translations = typeof zh

interface I18nContextType {
  locale: Locale
  t: Translations
  setLocale: (l: Locale) => void
}

const translations: Record<Locale, Translations> = { zh, en }

const I18nContext = createContext<I18nContextType>({
  locale: 'en',
  t: en,
  setLocale: () => {},
})

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window === 'undefined') return 'en'
    const saved = localStorage.getItem('locale') as Locale | null
    return saved && translations[saved] ? saved : 'en'
  })

  const setLocale = (l: Locale) => {
    setLocaleState(l)
    localStorage.setItem('locale', l)
  }

  return (
    <I18nContext.Provider value={{ locale, t: translations[locale], setLocale }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  return useContext(I18nContext)
}
