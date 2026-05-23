// JWT 签名/校验 + Cookie 工具（Web Crypto API，无 Node.js 依赖）

const DEFAULT_TTL_SECONDS = 86400 * 7;

function base64url(input) {
  let binary;
  if (typeof input === 'string') {
    const bytes = new TextEncoder().encode(input);
    binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
  } else {
    const bytes = new Uint8Array(input);
    binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  let value = str.replace(/-/g, '+').replace(/_/g, '/');
  while (value.length % 4) value += '=';
  return atob(value);
}

function base64urlDecodeUtf8(str) {
  const binary = base64urlDecode(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function constantTimeEqualBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function getSigningKey(secret) {
  if (!secret || typeof secret !== 'string') {
    throw new Error('JWT secret is required');
  }
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function normalizeSignOptions(legacyOrOptions) {
  if (legacyOrOptions == null) return {};
  if (typeof legacyOrOptions === 'number') {
    return { expiresInSeconds: legacyOrOptions };
  }
  if (typeof legacyOrOptions === 'object') return legacyOrOptions;
  throw new Error('Invalid signJWT options');
}

export async function signJWT(payload, secret, optionsOrTtl) {
  const options = normalizeSignOptions(optionsOrTtl);
  const expiresInSeconds = options.expiresInSeconds ?? DEFAULT_TTL_SECONDS;
  const now = Math.floor(Date.now() / 1000);

  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
    ...(options.issuer ? { iss: options.issuer } : {}),
    ...(options.audience ? { aud: options.audience } : {}),
  };

  const headerB64 = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadB64 = base64url(JSON.stringify(fullPayload));
  const data = `${headerB64}.${payloadB64}`;

  const key = await getSigningKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));

  return `${data}.${base64url(signature)}`;
}

export async function verifyJWT(token, secret, options = {}) {
  try {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;
    const data = `${headerB64}.${payloadB64}`;

    const key = await getSigningKey(secret);

    const sigBinary = base64urlDecode(signatureB64);
    const sigBytes = new Uint8Array(sigBinary.length);
    for (let i = 0; i < sigBinary.length; i++) {
      sigBytes[i] = sigBinary.charCodeAt(i);
    }

    const expected = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
    if (!constantTimeEqualBytes(new Uint8Array(expected), sigBytes)) return null;

    const payload = JSON.parse(base64urlDecodeUtf8(payloadB64));

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (options.issuer && payload.iss !== options.issuer) return null;
    if (options.audience && payload.aud !== options.audience) return null;

    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach((cookie) => {
    const [name, ...rest] = cookie.trim().split('=');
    if (name) cookies[name.trim()] = rest.join('=').trim();
  });
  return cookies;
}

function normalizeCookieOptions(legacyOrOptions) {
  if (legacyOrOptions == null) return {};
  if (typeof legacyOrOptions === 'string') return { cookieDomain: legacyOrOptions };
  return legacyOrOptions;
}

function buildAuthCookie({
  value,
  maxAge,
  cookieDomain = '',
  secure = true,
  sameSite = 'Lax',
  path = '/',
} = {}) {
  let cookie = `session=${value}; Path=${path}; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}`;
  if (secure) cookie += '; Secure';
  if (cookieDomain) cookie += `; Domain=${cookieDomain}`;
  return cookie;
}

export function setAuthCookie(token, maxAge = DEFAULT_TTL_SECONDS, optionsOrDomain = {}) {
  const options = normalizeCookieOptions(optionsOrDomain);
  return buildAuthCookie({ value: token, maxAge, ...options });
}

export function clearAuthCookie(optionsOrDomain = {}) {
  const options = normalizeCookieOptions(optionsOrDomain);
  return buildAuthCookie({ value: '', maxAge: 0, ...options });
}

function resolveSessionConfig(env) {
  const secret = env?.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  return {
    secret,
    issuer: env?.JWT_ISSUER || (env?.JWT_VALIDATE_ISSUER === 'true' && env?.PROJECT_ID) || undefined,
    audience: env?.JWT_AUDIENCE || undefined,
    cookieDomain: env?.COOKIE_DOMAIN || '',
    cookieSecure: env?.COOKIE_SECURE === 'false' ? false : true,
  };
}

export function getSessionConfig(env) {
  return resolveSessionConfig(env);
}

export async function getUser(request, env) {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const token = cookies.session;
  if (!token) return null;

  const config = resolveSessionConfig(env);
  return verifyJWT(token, config.secret, {
    issuer: config.issuer,
    audience: config.audience,
  });
}
