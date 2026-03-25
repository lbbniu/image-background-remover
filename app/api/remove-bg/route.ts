import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { image } = await request.json()

    if (!image) {
      return NextResponse.json(
        { success: false, error: 'No image provided' },
        { status: 400 }
      )
    }

    // Extract base64 data
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '')
    
    // Convert to buffer
    const buffer = Buffer.from(base64Data, 'base64')

    // Check file size (max 5MB)
    if (buffer.length > 5 * 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: 'Image too large. Max 5MB.' },
        { status: 400 }
      )
    }

    // Call Remove.bg API
    const formData = new FormData()
    formData.append('image_file', new Blob([buffer]), 'image.png')
    formData.append('size', 'auto')

    const apiKey = process.env.REMOVE_BG_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'API key not configured' },
        { status: 500 }
      )
    }

    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
      },
      body: formData,
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.errors?.[0]?.title || `API error: ${response.status}`)
    }

    // Get result image
    const resultBuffer = await response.arrayBuffer()
    const resultBase64 = Buffer.from(resultBuffer).toString('base64')

    return NextResponse.json({
      success: true,
      image: `data:image/png;base64,${resultBase64}`,
    })

  } catch (error) {
    console.error('Remove.bg API error:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Internal server error' 
      },
      { status: 500 }
    )
  }
}