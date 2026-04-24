'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import Image from 'next/image'
import Navbar from './components/Navbar'
import { useI18n } from './i18n'

export default function Home() {
  const { t } = useI18n()
  const [originalImage, setOriginalImage] = useState<string | null>(null)
  const [resultImage, setResultImage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [statusText, setStatusText] = useState('')
  const [user, setUser] = useState<{ id: string; name: string; email: string; avatar: string } | null>(null)
  const userChecked = useRef(false)

  // Check login status
  useEffect(() => {
    fetch('/api/auth/session')
      .then(res => res.json())
      .then(data => {
        if (data.authenticated) setUser(data.user)
      })
      .catch(() => {})
      .finally(() => { userChecked.current = true })
  }, [])

  // Client-side background removal (browser AI model)
  const removeBackgroundLocal = async (file: File): Promise<string> => {
    setStatusText(t.home.modelLoading)
    setUploadProgress(15)
    const { removeBackground } = await import('@imgly/background-removal')
    setStatusText(t.home.localProcessing)
    setUploadProgress(30)
    const blob = await removeBackground(file, {
      progress: (key: string, current: number, total: number) => {
        if (total > 0) {
          const pct = Math.round((current / total) * 100)
          setUploadProgress(30 + Math.round(pct * 0.65))
        }
      },
    })
    setUploadProgress(95)
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsDataURL(blob)
    })
  }

  // Server-side background removal (API, uses credits)
  const removeBackgroundAPI = async (base64: string): Promise<string> => {
    setStatusText(t.home.processing)
    setUploadProgress(30)
    const response = await fetch('/api/remove-bg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64 }),
    })
    setUploadProgress(70)
    const data = await response.json()
    if (!data.success) throw new Error(data.error || t.home.errFailed)
    return data.image
  }

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError(t.home.errNotImage)
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      setError(t.home.errTooLarge)
      return
    }

    setError(null)
    setLoading(true)
    setUploadProgress(0)
    setStatusText('')

    try {
      const base64 = await fileToBase64(file)
      setOriginalImage(base64)
      setUploadProgress(10)

      let resultDataUrl: string

      if (user) {
        // Logged in → server API (uses credits)
        resultDataUrl = await removeBackgroundAPI(base64)
      } else {
        // Not logged in → check free trial
        const freeUsed = localStorage.getItem('clearcut_free_used')
        if (freeUsed) {
          throw new Error(t.home.freeTrialUsed)
        }
        // Client-side processing (free trial)
        resultDataUrl = await removeBackgroundLocal(file)
        localStorage.setItem('clearcut_free_used', '1')
      }

      setUploadProgress(100)
      setTimeout(() => setResultImage(resultDataUrl), 300)
    } catch (err) {
      setError(err instanceof Error ? err.message : t.home.errFailed)
    } finally {
      setLoading(false)
      setStatusText('')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, t])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0])
    }
  }, [handleFile])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const onDragLeave = useCallback(() => {
    setDragOver(false)
  }, [])

  const onPaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) handleFile(file)
        break
      }
    }
  }, [handleFile])

  const reset = () => {
    setOriginalImage(null)
    setResultImage(null)
    setError(null)
    setUploadProgress(0)
    setStatusText('')
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && resultImage) {
        reset()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [resultImage])

  return (
    <div className="min-h-screen py-8 px-4" onPaste={onPaste}>
      <div className="max-w-6xl mx-auto">
        <Navbar activePage="home" />

        {/* Header */}
        <header className="text-center mb-12">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent glow-text">
              ClearCut
            </h1>
          </div>
          <p className="text-gray-400 text-lg md:text-xl max-w-2xl mx-auto">
            {t.home.tagline}
            <span className="text-cyan-400">{t.home.dot}</span>
            {t.home.subtitle1}
            <span className="text-cyan-400">{t.home.dot}</span>
            {t.home.subtitle2}
          </p>
        </header>

        {/* Main Content */}
        {!resultImage ? (
          <div className="glass-card rounded-3xl p-1 glow-border">
            <div
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              className={`upload-zone rounded-[22px] p-12 md:p-16 text-center cursor-pointer relative overflow-hidden ${
                dragOver ? 'active' : ''
              }`}
              onClick={() => !loading && document.getElementById('fileInput')?.click()}
            >
              <input
                type="file"
                id="fileInput"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />

              {loading ? (
                <div className="relative z-10">
                  <div className="loading-ring mb-6"></div>
                  <p className="text-xl font-medium text-white mb-2">
                    {statusText || t.home.processing}
                  </p>
                  <p className="text-gray-400 mb-6">
                    {statusText === t.home.modelLoading
                      ? t.home.modelLoadingDesc
                      : t.home.processingDesc}
                  </p>

                  {/* Free trial badge for non-logged-in users */}
                  {!user && (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 mb-4 rounded-full bg-emerald-500/20 border border-emerald-500/30">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-xs text-emerald-400 font-medium">{t.home.freeTrialBadge}</span>
                    </div>
                  )}
                  
                  <div className="max-w-xs mx-auto">
                    <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-cyan-500 transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                    <p className="text-sm text-gray-500 mt-2">{uploadProgress}%</p>
                  </div>
                </div>
              ) : (
                <div className="relative z-10">
                  <div className="w-24 h-24 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center border border-indigo-500/30" style={{width: '6rem', height: '6rem'}}>
                    <svg className="w-12 h-12 text-indigo-400" width={48} height={48} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  
                  <p className="text-2xl font-semibold text-white mb-2">
                    {t.home.dropzone}
                  </p>
                  <p className="text-gray-400 mb-6">
                    {t.home.paste} <span className="px-2 py-1 bg-gray-800 rounded text-sm text-cyan-400">Ctrl+V</span>
                    <span className="mx-2">/</span>
                    {t.home.click}
                  </p>
                  
                  <div className="flex flex-wrap justify-center gap-3">
                    <span className="px-3 py-1.5 bg-gray-800/50 rounded-full text-sm text-gray-400 border border-gray-700">JPG</span>
                    <span className="px-3 py-1.5 bg-gray-800/50 rounded-full text-sm text-gray-400 border border-gray-700">PNG</span>
                    <span className="px-3 py-1.5 bg-gray-800/50 rounded-full text-sm text-gray-400 border border-gray-700">WEBP</span>
                  </div>
                </div>
              )}

              <div className="absolute top-4 left-4 w-20 h-20 border-l-2 border-t-2 border-indigo-500/20 rounded-tl-3xl" />
              <div className="absolute top-4 right-4 w-20 h-20 border-r-2 border-t-2 border-indigo-500/20 rounded-tr-3xl" />
              <div className="absolute bottom-4 left-4 w-20 h-20 border-l-2 border-b-2 border-indigo-500/20 rounded-bl-3xl" />
              <div className="absolute bottom-4 right-4 w-20 h-20 border-r-2 border-b-2 border-indigo-500/20 rounded-br-3xl" />
            </div>
          </div>
        ) : (
          <div className="glass-card rounded-3xl p-6 md:p-8 glow-border">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">{t.home.result}</h2>
              <button
                onClick={reset}
                className="btn-secondary px-4 py-2 rounded-lg text-sm flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {t.home.reupload}
              </button>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">{t.home.original}</span>
                  <span className="text-xs text-gray-500">Original</span>
                </div>
                <div className="image-container rounded-xl overflow-hidden aspect-square relative">
                  {originalImage && (
                    <Image
                      src={originalImage}
                      alt={t.home.original}
                      fill
                      unoptimized
                      className="object-contain"
                    />
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">{t.home.processed}</span>
                  <span className="text-xs text-cyan-400">AI Processed</span>
                </div>
                <div className="image-container rounded-xl overflow-hidden aspect-square relative">
                  {resultImage && (
                    <Image
                      src={resultImage}
                      alt={t.home.processed}
                      fill
                      unoptimized
                      className="object-contain"
                    />
                  )}
                  <div className="absolute top-2 right-2 px-2 py-1 bg-cyan-500/20 backdrop-blur rounded text-xs text-cyan-400 border border-cyan-500/30">
                    {t.home.transparent}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center mt-8">
              <a
                href={resultImage || '#'}
                download="clearcut-result.png"
                className="btn-primary px-8 py-4 rounded-xl font-semibold text-center flex items-center justify-center gap-3"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {t.home.download}
              </a>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mt-6 glass-card rounded-xl p-4 border border-red-500/30">
            <div className="flex items-center gap-3 text-red-400">
              <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p>{error}</p>
              {error === t.home.freeTrialUsed && (
                <a href="/api/oauth/google/authorization" className="ml-auto shrink-0 btn-primary px-4 py-2 rounded-lg text-sm font-medium">
                  {t.nav.login}
                </a>
              )}
            </div>
          </div>
        )}

        {/* Features */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-12">
          {[
            { icon: '⚡', title: t.home.fastTitle, desc: t.home.fastDesc },
            { icon: '🎯', title: t.home.preciseTitle, desc: t.home.preciseDesc },
            { icon: '🔒', title: t.home.privacyTitle, desc: t.home.privacyDesc },
            { icon: '💎', title: t.home.hdTitle, desc: t.home.hdDesc },
          ].map((feature, i) => (
            <div key={i} className="glass-card rounded-2xl p-4 text-center hover:border-indigo-500/30 transition-colors">
              <div className="text-3xl mb-2">{feature.icon}</div>
              <p className="font-medium text-white">{feature.title}</p>
              <p className="text-sm text-gray-500">{feature.desc}</p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <footer className="mt-16 text-center text-gray-500 text-sm">
          <p className="flex items-center justify-center gap-2 flex-wrap">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              {t.home.status}
            </span>
            <span className="text-gray-700">|</span>
            <span>{t.home.useCases}</span>
          </p>
        </footer>
      </div>
    </div>
  )
}
