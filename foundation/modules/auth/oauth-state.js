// OAuth state CSRF 防护工具：在 authorize 跳转前生成随机 state，写入短期 httpOnly cookie，
// 同时把同样的值放进 OAuth 跳转链接的 state 参数；callback 时严格比对两者，不一致拒绝。

const STATE_COOKIE_NAME = 'oauth_state';
const STATE_TTL_SECONDS = 600; // 10 分钟够走完登录流程，且不会让 cookie 长期存在

function constantTimeStringEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function generateOAuthState() {
  return crypto.randomUUID().replace(/-/g, '');
}

export function buildOAuthStateCookie(state, { secure = true, sameSite = 'Lax' } = {}) {
  const parts = [
    `${STATE_COOKIE_NAME}=${state}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`,
    `Max-Age=${STATE_TTL_SECONDS}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearOAuthStateCookie({ secure = true, sameSite = 'Lax' } = {}) {
  const parts = [
    `${STATE_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`,
    'Max-Age=0',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function readOAuthStateFromCookies(cookies) {
  return cookies?.[STATE_COOKIE_NAME] || null;
}

export function verifyOAuthState({ stateFromQuery, stateFromCookie }) {
  if (!stateFromQuery || !stateFromCookie) return false;
  return constantTimeStringEqual(stateFromQuery, stateFromCookie);
}

export const OAUTH_STATE_COOKIE_NAME = STATE_COOKIE_NAME;
