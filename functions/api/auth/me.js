// 获取当前登录用户信息
import { getUser } from '../../lib/auth.js';

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
