function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { image } = await request.json();

    if (!image) {
      return Response.json(
        { success: false, error: 'No image provided' },
        { status: 400 }
      );
    }

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const bytes = base64ToUint8Array(base64Data);

    if (bytes.length > 5 * 1024 * 1024) {
      return Response.json(
        { success: false, error: 'Image too large. Max 5MB.' },
        { status: 400 }
      );
    }

    const formData = new FormData();
    formData.append('image_file', new Blob([bytes]), 'image.png');
    formData.append('size', 'auto');

    const apiKey = env.REMOVE_BG_API_KEY;
    if (!apiKey) {
      return Response.json(
        { success: false, error: 'API key not configured' },
        { status: 500 }
      );
    }

    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey },
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.errors?.[0]?.title || `API error: ${response.status}`);
    }

    const resultBuffer = await response.arrayBuffer();
    const resultBase64 = arrayBufferToBase64(resultBuffer);

    return Response.json({
      success: true,
      image: `data:image/png;base64,${resultBase64}`,
    });

  } catch (error) {
    console.error('Remove.bg API error:', error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      },
      { status: 500 }
    );
  }
}
