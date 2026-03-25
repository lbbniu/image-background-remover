'use client'

import { useState, useCallback } from 'react'

export default function Home() {
  const [originalImage, setOriginalImage] = useState<string | null>(null)
  const [resultImage, setResultImage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('请上传图片文件')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('图片太大，请压缩至 5MB 以下')
      return
    }

    setError(null)
    setLoading(true)

    try {
      const base64 = await fileToBase64(file)
      setOriginalImage(base64)

      const response = await fetch('/api/remove-bg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64 }),
      })

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.error || '处理失败')
      }

      setResultImage(data.image)
    } catch (err) {
      setError(err instanceof Error ? err.message : '处理失败，请重试')
    } finally {
      setLoading(false)
    }
  }, [])

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

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
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl" onPaste={onPaste}>
      <header className="text-center mb-10">
        <h1 className="text-4xl font-bold text-gray-800 mb-2">🖼️ ClearCut</h1>
        <p className="text-gray-600 text-lg">3秒智能抠图，无需注册，即传即走</p>
      </header>

      {!resultImage ? (
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          className={`rounded-2xl p-12 text-center bg-white shadow-sm mb-8 border-3 border-dashed transition-all cursor-pointer ${
            dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
          }`}
          style={{ borderWidth: '3px' }}
          onClick={() => document.getElementById('fileInput')?.click()}
        >
          <input
            type="file"
            id="fileInput"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />

          {loading ? (
            <div>
              <div className="text-6xl mb-4 animate-pulse">✨</div>
              <p className="text-xl text-gray-700">正在智能抠图中...</p>
              <p className="text-gray-500 mt-2">请稍候，AI 正在处理</p>
            </div>
          ) : (
            <div>
              <div className="text-6xl mb-4">📤</div>
              <p className="text-xl text-gray-700 mb-2">拖放图片到这里</p>
              <p className="text-gray-500 mb-4">或粘贴 (Ctrl+V) / 点击选择</p>
              <p className="text-sm text-gray-400">支持 JPG、PNG、WEBP (最大 5MB)</p>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4 text-center">处理结果</h2>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="text-center">
              <p className="text-sm text-gray-500 mb-2">原图</p>
              <div className="bg-gray-100 rounded-lg p-2">
                {originalImage && (
                  <img src={originalImage} alt="原图" className="max-w-full rounded" />
                )}
              </div>
            </div>

            <div className="text-center">
              <p className="text-sm text-gray-500 mb-2">抠图后</p>
              <div 
                className="rounded-lg p-2"
                style={{
                  backgroundImage: 'linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)',
                  backgroundSize: '20px 20px',
                  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px'
                }}
              >
                {resultImage && (
                  <img src={resultImage} alt="抠图结果" className="max-w-full rounded" />
                )}
              </div>
            </div>
          </div>

          <div className="text-center mt-6 space-x-4">
            <a
              href={resultImage || '#'}
              download="clearcut-result.png"
              className="inline-block bg-blue-600 text-white px-8 py-3 rounded-lg font-medium hover:bg-blue-700 transition"
            >
              💾 下载透明背景PNG
            </a>
            <button
              onClick={reset}
              className="inline-block bg-gray-200 text-gray-700 px-6 py-3 rounded-lg font-medium hover:bg-gray-300 transition"
            >
              🔄 重新上传
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 text-center">
          <p className="text-red-600">{error}</p>
        </div>
      )}

      <footer className="mt-12 text-center text-gray-500 text-sm">
        <p className="mb-2">💡 小贴士：证件照、商品图、表情包、设计素材</p>
        <p>🔒 图片仅内存处理，保护您的隐私</p>
      </footer>
    </div>
  )
}