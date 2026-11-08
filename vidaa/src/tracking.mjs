// Report playback progress to YouTube so signed-in watch history works.
//
// The player response includes playbackTracking URLs with ei/vm/of/len/plid
// already present. SmartTube creates a playback record first and then sends
// watchtime updates; the same shape is used here.
//
// The playback record is what creates the history entry. On VIDAA the browser
// reliably performs the watchtime GET but can drop other requests issued while
// the video is starting. So the record is attached to the first watchtime
// request as `ytrec=<start position>`; the Worker sees that marker, sends the
// record to YouTube server-side, and strips the marker before forwarding.

import {getAccessToken} from './auth.mjs';
import {PROXY_BASE,proxyUrl} from './config.mjs';

function playbackNonce() {
  const bytes = new Uint8Array(16);
  try { crypto.getRandomValues(bytes); } catch (_) {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}

function debugSend(event, extra) {
  if (!PROXY_BASE) return;
  try {
    fetch(PROXY_BASE.replace(/\/+$/, '') + '/debug/log', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(Object.assign({event: event, at: new Date().toISOString()}, extra || {}))
    }).catch(function () {});
  } catch (_) {}
}

export function trackingUrl(base, params) {
  if (!base) return '';
  try {
    const url = new URL(base);
    if (!url.searchParams.get('ns')) url.searchParams.set('ns', 'yt');
    if (!url.searchParams.get('ver')) url.searchParams.set('ver', '2');
    for (const [name, value] of Object.entries(params || {})) {
      if (value !== undefined && value !== null) url.searchParams.set(name, String(value));
    }
    return url.href;
  } catch (_) {
    return '';
  }
}

async function send(base, params) {
  if (!base) return {ok: false, reason: 'no-url'};
  const url = trackingUrl(base, params);
  if (!url) return {ok: false, reason: 'bad-url'};
  try {
    const token = await getAccessToken();
    if (!token) return {ok: false, reason: 'no-token'};
    const target = PROXY_BASE ? proxyUrl(url, PROXY_BASE) : url;
    const response = await fetch(target, {
      headers: {Authorization: 'Bearer ' + token},
      credentials: 'omit',
      cache: 'no-store'
    });
    return {ok: response.ok, status: response.status};
  } catch (error) {
    return {ok: false, reason: error && error.message ? error.message : 'network'};
  }
}

function createMediaInfoTracker(info, clientName) {
  let started = false, finished = false, lastTick = 0;
  const call = promise => { try { const result = promise; if (result && result.catch) result.catch(() => {}); } catch (_) {} };
  return {
    method: 'mediaInfo',
    start(position = 0) {
      if (started) return;
      started = true;
      lastTick = Date.now();
      call(info.addToWatchHistory());
    },
    tick(position) {
      if (!started || finished) return;
      const now = Date.now();
      if (now - lastTick < 10000) return;
      lastTick = now;
      call(info.updateWatchTime(Math.max(0, Number(position) || 0)));
    },
    finish(position = 0) {
      if (!started || finished) return;
      finished = true;
      call(info.updateWatchTime(Math.max(0, Number(position) || 0)));
    }
  };
}

export function createTracker(tracking, videoId, duration) {
  if (!tracking) return null;
  if (tracking.mediaInfo && typeof tracking.mediaInfo.addToWatchHistory === 'function') {
    return createMediaInfoTracker(tracking.mediaInfo, tracking.client);
  }
  const watchtime = (tracking.videostatsWatchtimeUrl && tracking.videostatsWatchtimeUrl.baseUrl) ||
    tracking.videostats_watchtime_url;
  if (!watchtime) return null;
  const cpn = (typeof tracking.cpn === 'string' && tracking.cpn) ? tracking.cpn : playbackNonce();
  const length = Math.max(0, Number(duration) || 0);
  const id = cpn.slice(0, 8);
  let started = false, finished = false, lastSent = 0;
  let recordStart = 0, recordSent = false;

  function report(result, position) {
    if (result.ok && !recordSent) {
      recordSent = true;
      debugSend('stats-record', {id: id, ok: true, status: result.status || null,
        via: 'watchtime', startAt: recordStart, at: position});
    }
  }

  return {
    method: 'url',
    start(position = 0) {
      if (started) return;
      started = true;
      lastSent = Math.max(0, Number(position) || 0);
      recordStart = lastSent;
      // The record itself is sent together with the first watchtime request.
    },
    tick(position, playing = true) {
      if (!started || finished || !playing) return;
      const current = Math.max(0, Number(position) || 0);
      if (recordSent && Math.abs(current - lastSent) < 10) return;
      const st = lastSent;
      lastSent = current;
      const params = {docid: videoId, len: length || undefined, cpn,
        st, et: current, cmt: current, final: 0};
      if (!recordSent) {
        params.ytrec = recordStart;
        debugSend('stats-record-attempt', {id: id, startAt: recordStart, at: current});
      }
      send(watchtime, params).then(result => {
        report(result, current);
        if (!result.ok) debugSend('stats-watchtime-fail', {id: id,
          status: result.status || null, reason: result.reason || null, at: current});
      });
    },
    finish(position = 0) {
      if (!started || finished) return;
      finished = true;
      const current = Math.max(0, Number(position) || 0);
      const params = {docid: videoId, len: length || undefined, cpn,
        st: lastSent, et: current, cmt: current, final: 1};
      if (!recordSent) {
        params.ytrec = recordStart;
        debugSend('stats-record-attempt', {id: id, startAt: recordStart, at: current, final: true});
      }
      send(watchtime, params).then(result => report(result, current));
    }
  };
}
