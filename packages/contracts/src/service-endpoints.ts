export const VIVIDROP_ROOT_DOMAIN = 'vividrop.cn';
export const VIVIDROP_WEB_BASE_URL = `https://www.${VIVIDROP_ROOT_DOMAIN}`;
export const VIVIDROP_API_BASE_URL = `https://api.${VIVIDROP_ROOT_DOMAIN}`;
export const VIVIDROP_GLOBAL_API_BASE_URL = `https://global-api.${VIVIDROP_ROOT_DOMAIN}`;
export const VIVIDROP_REVIEW_API_BASE_URL = `https://review-api.${VIVIDROP_ROOT_DOMAIN}`;
export const VIVIDROP_SUPPORT_EMAIL = `support@${VIVIDROP_ROOT_DOMAIN}`;
export const VIVIDROP_APPLE_GLOBAL_REDIRECT_URI = `${VIVIDROP_GLOBAL_API_BASE_URL}/auth/apple/callback`;
export const VIVIDROP_TURN_URL = `turn:turn.${VIVIDROP_ROOT_DOMAIN}:3478?transport=udp`;

export const VIVIDROP_SERVICE_ENDPOINTS = Object.freeze({
  webBaseUrl: VIVIDROP_WEB_BASE_URL,
  apiBaseUrl: VIVIDROP_API_BASE_URL,
  globalApiBaseUrl: VIVIDROP_GLOBAL_API_BASE_URL,
  reviewApiBaseUrl: VIVIDROP_REVIEW_API_BASE_URL,
  supportEmail: VIVIDROP_SUPPORT_EMAIL,
  appleGlobalRedirectUri: VIVIDROP_APPLE_GLOBAL_REDIRECT_URI,
  turnUrl: VIVIDROP_TURN_URL,
});
