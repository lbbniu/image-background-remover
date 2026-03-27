// Google OAuth 登录入口 — 重定向到 Google 授权页面

export async function onRequestGet(context) {
  const { env, request } = context;

  const clientId = env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return Response.json({ error: 'Google OAuth not configured' }, { status: 500 });
  }

  // 获取当前域名作为回调地址
  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/auth/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent',
  });

  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
}
