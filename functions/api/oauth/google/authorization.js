import { getOAuthRedirectUri } from '../../../../foundation/modules/core/index.js';

export async function onRequestGet(context) {
  const { env, request } = context;

  const clientId = env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return Response.json({ error: 'Google OAuth not configured' }, { status: 500 });
  }

  const redirectUri = getOAuthRedirectUri(env, request, 'google');
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
