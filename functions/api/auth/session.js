import { clearAuthCookie, getUser } from '../../../foundation/modules/auth/index.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const user = await getUser(request, env);

  if (!user) {
    return Response.json({ authenticated: false }, { status: 401 });
  }

  return Response.json({
    authenticated: true,
    user: {
      id: user.sub,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
    },
  });
}

export async function onRequestDelete(context) {
  const { env } = context;
  return Response.json(
    { authenticated: false },
    {
      headers: {
        'Set-Cookie': clearAuthCookie({
          cookieDomain: env.COOKIE_DOMAIN || '',
          secure: env.COOKIE_SECURE === 'false' ? false : true,
        }),
      },
    },
  );
}
