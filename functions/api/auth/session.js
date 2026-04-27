import { clearAuthCookie, getUser } from '../../../foundation/modules/auth/session.js';

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
  return Response.json(
    { authenticated: false },
    {
      headers: {
        'Set-Cookie': clearAuthCookie(context.env.COOKIE_DOMAIN || ''),
      },
    },
  );
}
