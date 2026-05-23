import { buildOAuthStateCookie, generateOAuthState, getSessionConfig } from '../../../../foundation/modules/auth/index.js';
import { getOAuthRedirectUri } from '../../../../foundation/modules/core/index.js';

export async function onRequestGet(context) {
  const { env, request } = context;

  const clientId = env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return Response.json({ error: 'Google OAuth not configured' }, { status: 500 });
  }

  // 必须先确保 JWT_SECRET 已配置（getSessionConfig 内部会抛错），否则 cookieSecure 等参数无解。
  const sessionConfig = getSessionConfig(env);
  const state = generateOAuthState();

  const redirectUri = getOAuthRedirectUri(env, request, 'google');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  return new Response(null, {
    status: 302,
    headers: {
      'Location': `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      'Set-Cookie': buildOAuthStateCookie(state, { secure: sessionConfig.cookieSecure }),
    },
  });
}
