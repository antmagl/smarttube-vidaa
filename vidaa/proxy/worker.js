// Cloudflare Worker: CORS proxy for YouTube media/API plus TV OAuth endpoints.
//
// The VIDAA web app runs on GitHub Pages. googlevideo.com does not grant CORS
// to arbitrary web origins, and YouTube's API rejects third-party preflights.
// This Worker fetches the allowed YouTube hosts, adds CORS, rewrites HLS
// manifests, forwards API POST bodies and Authorization headers, and exchanges
// the YouTube TV device code for tokens.
//
// Deploy it from the Cloudflare dashboard (paste this file) or with
// `npx wrangler deploy` from this directory. It has no storage and no
// credentials beyond the public TV OAuth client used by SmartTube.

const MANIFEST_TYPE = /mpegurl|m3u8/i;
const ALLOWED_HOSTS = [
  'googlevideo.com',
  'youtube.com',
  'youtubei.googleapis.com',
  'googleapis.com'
];

// Public YouTube TV OAuth client used by the open-source SmartTube app.
// The secret is not a user secret; the user still authorizes the device code.
const TV_CLIENT_ID = '861556708454-d6dlm3lh05idd8npek18k6be8ba3oc68.apps.googleusercontent.com';
const TV_CLIENT_SECRET = 'SboVhoG9s0rNafixCSGGKXAT';
const TV_SCOPE = 'http://gdata.youtube.com https://www.googleapis.com/auth/youtube-paid-content';
const TV_GRANT = 'http://oauth.net/grant_type/device/1.0';
const SAMSUNG_TV_UA = 'Mozilla/5.0 (SMART-TV; Linux; Tizen 2.4.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/2.4.0 TV Safari/538.1';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range, If-Range, Accept, Accept-Language, X-Goog-Visitor-Id, X-Goog-AuthUser, X-Goog-PageId, X-Goog-Api-Format-Version, X-YouTube-Client-Name, X-YouTube-Client-Version',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
  'Access-Control-Max-Age': '86400'
};

export function isAllowed(target) {
  const host = target.hostname.toLowerCase().replace(/\.$/, '');
  return ALLOWED_HOSTS.some(name => host === name || host.endsWith('.' + name));
}

export function proxyUrl(origin, target) {
  return origin.replace(/\/+$/, '') + '/?url=' + encodeURIComponent(target);
}

// Rewrite both absolute and relative HLS URIs. YouTube currently emits
// absolute URLs, but media playlists can contain relative URIs too.
export function rewriteManifest(text, origin, baseUrl) {
  const resolve = raw => {
    try {
      const url = new URL(raw, baseUrl);
      if (isAllowed(url)) return proxyUrl(origin, url.href);
    } catch (_) { /* leave the original line untouched */ }
    return raw;
  };
  return String(text).split(/\r?\n/).map(line => {
    if (line.startsWith('#') && line.indexOf('URI="') !== -1) {
      return line.replace(/URI="([^"]+)"/g, (match, raw) => 'URI="' + resolve(raw) + '"');
    }
    if (line && !line.startsWith('#')) return resolve(line);
    return line;
  }).join('\n');
}

function withCors(response) {
  for (const [name, value] of Object.entries(CORS_HEADERS)) response.headers.set(name, value);
  return response;
}

function json(data, status = 200) {
  return withCors(new Response(JSON.stringify(data), {
    status,
    headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}
  }));
}

async function bodyJson(request) {
  try { return await request.json(); } catch (_) { return {}; }
}

async function youtubeOAuth(path, body) {
  return fetch('https://www.youtube.com/o/oauth2/' + path, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body)
  });
}

async function deviceCode(request) {
  if (request.method !== 'POST') return json({error: 'method_not_allowed'}, 405);
  const body = await bodyJson(request);
  const deviceId = String(body.device_id || '').slice(0, 64) || crypto.randomUUID();
  const upstream = await youtubeOAuth('device/code', {
    client_id: TV_CLIENT_ID,
    device_id: deviceId,
    model_name: 'ytlr::',
    scope: TV_SCOPE
  });
  const text = await upstream.text();
  return withCors(new Response(text, {
    status: upstream.status,
    headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}
  }));
}

async function accessToken(request) {
  if (request.method !== 'POST') return json({error: 'method_not_allowed'}, 405);
  const body = await bodyJson(request);
  if (!body.device_code) return json({error: 'missing_device_code'}, 400);
  const upstream = await youtubeOAuth('token', {
    code: String(body.device_code),
    client_id: TV_CLIENT_ID,
    client_secret: TV_CLIENT_SECRET,
    grant_type: TV_GRANT
  });
  const text = await upstream.text();
  return withCors(new Response(text, {
    status: upstream.status,
    headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}
  }));
}

async function refreshToken(request) {
  if (request.method !== 'POST') return json({error: 'method_not_allowed'}, 405);
  const body = await bodyJson(request);
  if (!body.refresh_token) return json({error: 'missing_refresh_token'}, 400);
  const upstream = await youtubeOAuth('token', {
    refresh_token: String(body.refresh_token),
    client_id: TV_CLIENT_ID,
    client_secret: TV_CLIENT_SECRET,
    grant_type: 'refresh_token'
  });
  const text = await upstream.text();
  try {
    const data = JSON.parse(text);
    if (data.error) console.log('SMARTTUBE_AUTH refresh ' + upstream.status + ' ' + data.error);
  } catch (_) {}
  return withCors(new Response(text, {
    status: upstream.status,
    headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}
  }));
}

async function proxy(request, requestUrl) {
  if (request.method === 'OPTIONS') return withCors(new Response(null, {status: 204}));
  if (!['GET', 'HEAD', 'POST'].includes(request.method)) {
    return withCors(new Response('Method not allowed', {status: 405}));
  }

  const raw = requestUrl.searchParams.get('url');
  if (!raw) return withCors(new Response('Missing url parameter', {status: 400}));
  let target;
  try { target = new URL(raw); } catch (_) {
    return withCors(new Response('Invalid url parameter', {status: 400}));
  }
  if (target.protocol !== 'https:' || !isAllowed(target)) {
    return withCors(new Response('Host not allowed', {status: 403}));
  }

  const headers = new Headers();
  for (const name of ['range', 'if-range', 'accept', 'accept-language', 'content-type',
                      'authorization', 'x-goog-visitor-id', 'x-goog-authuser', 'x-goog-pageid',
                      'x-goog-api-format-version', 'x-youtube-client-name',
                      'x-youtube-client-version']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  // Read the player body before choosing the User-Agent: the YouTube TV
  // endpoint needs a TV identity, but the public profiles should keep their
  // own identity so they are not mistaken for a TV client.
  let body;
  let playerClient = '';
  if (request.method === 'POST') {
    body = await request.arrayBuffer();
    if (target.pathname.indexOf('/youtubei/v1/player') === 0) {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(body));
        playerClient = String(parsed?.context?.client?.clientName || '');
      } catch (_) {}
    }
  }

  // YouTube serves a tiny consent/unsupported page to generic Worker UAs and
  // only exposes the TV visitor/player script to a TV-like browser UA. The
  // browser cannot set User-Agent itself, so set it here for the TV page and
  // player script.
  if (target.hostname === 'www.youtube.com' &&
      (target.pathname === '/tv' || target.pathname.indexOf('/s/player/') === 0)) {
    headers.set('User-Agent', 'Mozilla/5.0 (Linux; Android 9; VIDAA) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36');
    if (!headers.has('Accept-Language')) headers.set('Accept-Language', 'en-US,en;q=0.9');
  }
  // The TVHTML5 endpoint validates the device UA. Other player profiles must
  // keep their own identity: forcing a TV UA on them can trigger the
  // "Sign in to confirm you're not a bot" challenge.
  if (target.hostname === 'www.youtube.com' && target.pathname.indexOf('/youtubei/v1/player') === 0 &&
      playerClient.indexOf('TVHTML5') !== -1) {
    headers.set('User-Agent', SAMSUNG_TV_UA);
  }
  if (target.hostname === 's.youtube.com' && target.pathname.indexOf('/api/stats/') === 0) {
    headers.set('User-Agent', SAMSUNG_TV_UA);
  }

  const recordMarker = target.searchParams.get('ytrec');
  if (recordMarker !== null && target.pathname === '/api/stats/watchtime') {
    // The TV reliably sends the watchtime GET but may drop the separate
    // playback request while the video starts. Send the record that creates
    // the history entry from here, then forward the watchtime normally.
    target.searchParams.delete('ytrec');
    try {
      const record = new URL(target.href);
      record.pathname = '/api/stats/playback';
      record.searchParams.delete('st');
      record.searchParams.delete('et');
      record.searchParams.delete('final');
      record.searchParams.set('cmt', recordMarker);
      const recordUpstream = await fetch(record.href, {headers, redirect: 'follow'});
      try { console.log('SMARTTUBE_STATS /api/stats/playback -> ' + recordUpstream.status); } catch (_) {}
    } catch (_) {
      try { console.log('SMARTTUBE_STATS /api/stats/playback -> failed'); } catch (_) {}
    }
  }

  let upstream;
  try {
    upstream = await fetch(target.href, {
      method: request.method,
      headers,
      body,
      redirect: 'follow'
    });
  } catch (_) {
    return withCors(new Response('Upstream fetch failed', {status: 502}));
  }

  if (target.pathname.indexOf('/youtubei/') !== -1 || target.pathname === '/tv' || target.pathname.indexOf('/s/player/') !== -1 ||
      target.pathname.indexOf('/api/stats/') === 0) {
    try { console.log('SMARTTUBE_PROXY ' + request.method + ' ' + target.hostname + target.pathname + ' -> ' + upstream.status); } catch (_) {}
  }
  if (target.pathname.indexOf('/youtubei/v1/player') === 0) {
    try {
      const clone = upstream.clone();
      const data = await clone.json();
      const status = String(data?.playabilityStatus?.status || '?');
      const reason = String(data?.playabilityStatus?.reason || '').slice(0, 160);
      console.log('SMARTTUBE_PLAYER ' + (playerClient || '?') + ' -> ' + upstream.status + ' ' + status + ' ' + reason);
    } catch (_) {}
  }
  const type = upstream.headers.get('content-type') || '';
  const looksLikeManifest = MANIFEST_TYPE.test(type) || /\.m3u8($|\?)/i.test(target.pathname + target.search);
  if (looksLikeManifest && request.method !== 'HEAD') {
    const text = await upstream.text();
    return withCors(new Response(rewriteManifest(text, requestUrl.origin, upstream.url || target.href), {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    }));
  }

  const out = new Headers();
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  out.set('Cache-Control', 'no-store');
  return withCors(new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: out
  }));
}

async function statsRecord(request) {
  if (request.method !== 'POST') return json({error: 'method_not_allowed'}, 405);
  let body;
  try { body = await request.json(); } catch (_) { return json({error: 'bad_json'}, 400); }
  let target;
  try { target = new URL(String(body.url || '')); } catch (_) { return json({error: 'bad_url'}, 400); }
  const host = target.hostname.toLowerCase();
  if ((host !== 's.youtube.com' && host !== 'www.youtube.com') ||
      target.pathname.indexOf('/api/stats/') !== 0 ||
      target.protocol !== 'https:') {
    return json({error: 'not_allowed'}, 403);
  }
  const headers = {'User-Agent': SAMSUNG_TV_UA};
  const token = String(body.token || '');
  if (token) headers.Authorization = 'Bearer ' + token;
  let upstream;
  try {
    upstream = await fetch(target.href, {headers, redirect: 'follow'});
  } catch (_) {
    return json({ok: false, error: 'upstream_failed'}, 502);
  }
  try {
    console.log('SMARTTUBE_STATS ' + target.pathname + ' -> ' + upstream.status);
  } catch (_) {}
  return json({ok: upstream.ok, status: upstream.status});
}

export default {
  async fetch(request) {
    const requestUrl = new URL(request.url);
    if (request.method === 'OPTIONS') return withCors(new Response(null, {status: 204}));
    if (requestUrl.pathname === '/stats') return statsRecord(request);
    if (requestUrl.pathname === '/debug/log') {
      if (request.method !== 'POST') return json({error: 'method_not_allowed'}, 405);
      const text = await request.text();
      try { console.log('SMARTTUBE_DEBUG ' + text.slice(0, 3000)); } catch (_) {}
      return json({ok: true});
    }
    if (requestUrl.pathname === '/auth/device') return deviceCode(request);
    if (requestUrl.pathname === '/auth/token') return accessToken(request);
    if (requestUrl.pathname === '/auth/refresh') return refreshToken(request);
    return proxy(request, requestUrl);
  }
};
