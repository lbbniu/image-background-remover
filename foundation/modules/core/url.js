export function getAppOrigin(env, request) {
  const configuredUrl = env.APP_URL || env.SITE_URL || env.PUBLIC_APP_URL;
  if (configuredUrl) {
    return new URL(configuredUrl).origin;
  }

  return new URL(request.url).origin;
}

export function getOAuthRedirectUri(env, request, platform) {
  return `${getAppOrigin(env, request)}/api/oauth/${platform}/callback`;
}
