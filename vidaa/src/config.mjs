// Set this to the deployed Cloudflare Worker URL to enable 1080p/60fps HLS.
// Leave it empty for the no-proxy build, which uses only the 360p/240p
// combined MP4 that a plain <video> element can fetch without CORS.
//
// Example:
// export const PROXY_BASE = 'https://smarttube-vidaa-proxy.example.workers.dev';
const injected = typeof __SMARTTUBE_PROXY__ === 'string' ? __SMARTTUBE_PROXY__ : '';
export const PROXY_BASE = injected;

export function proxyUrl(url, base = PROXY_BASE) {
  if (!base) return url;
  return base.replace(/\/+$/, '') + '/?url=' + encodeURIComponent(url);
}

export function isProxyUrl(url, base = PROXY_BASE) {
  if (!base) return false;
  return String(url).indexOf(base.replace(/\/+$/, '') + '/') === 0;
}
