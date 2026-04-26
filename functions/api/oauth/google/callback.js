import { signJWT, setAuthCookie } from '../../../lib/auth.js';
import { getProjectId } from '../../../lib/core/projects.js';
import { findOrCreateOAuthUser } from '../../../lib/oauth.js';
import { getAppOrigin, getOAuthRedirectUri } from '../../../lib/url.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const appOrigin = getAppOrigin(env, request);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error || !code) {
    return Response.redirect(`${appOrigin}/?error=auth_failed`, 302);
  }

  let step = 'init';
  try {
    const redirectUri = getOAuthRedirectUri(env, request, 'google');
    step = 'token_exchange';

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('Token exchange failed:', errText);
      return Response.redirect(`${appOrigin}/?error=token_failed`, 302);
    }

    const tokens = await tokenRes.json();
    step = 'userinfo';

    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userRes.ok) {
      return Response.redirect(`${appOrigin}/?error=userinfo_failed`, 302);
    }

    const googleUser = await userRes.json();
    step = 'db';

    let userId = googleUser.id;
    if (env.DB) {
      try {
        userId = await findOrCreateOAuthUser(env.DB, {
          platform: 'google',
          externalId: googleUser.id,
          email: googleUser.email,
          name: googleUser.name,
          avatar: googleUser.picture,
          projectId: getProjectId(env),
        });
      } catch (dbErr) {
        console.error('D1 error (non-fatal):', dbErr);
      }
    }

    step = 'jwt';
    const secret = env.JWT_SECRET || 'clearcut-default-secret-change-me';
    const jwt = await signJWT({
      sub: String(userId),
      email: googleUser.email,
      name: googleUser.name,
      avatar: googleUser.picture,
    }, secret);

    return new Response(null, {
      status: 302,
      headers: {
        'Location': `${appOrigin}/`,
        'Set-Cookie': setAuthCookie(jwt, undefined, env.COOKIE_DOMAIN || ''),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`OAuth callback error at step [${step}]:`, err);
    return Response.redirect(
      `${appOrigin}/?error=server_error&step=${step}&detail=${encodeURIComponent(msg.substring(0, 200))}`,
      302,
    );
  }
}
