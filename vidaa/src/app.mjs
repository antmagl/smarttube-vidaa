import './polyfills.mjs';
import Hls from 'hls.js';
import dashjs from 'dashjs/dist/dash.mediaplayer.min.js';
import {createDashPlayer} from './dash-player.mjs';
import {markFormatSupport} from './adaptive.mjs';
import {createHlsPlayer,findHlsLevel} from './hls-player.mjs';
import {VideoProvider} from './provider.mjs';
import {createSession} from './session.mjs';
import {SponsorSession,SKIP_PRESETS} from './core.mjs';
import {codecLabel,resolutionLabel} from './formats.mjs';
import {gridTarget,readHistory,rememberVideo,preferredFormat,withFormat} from './ui-state.mjs';
import {normalizeKey,exitApp,deviceInfo,mediaCapabilities} from './platform.mjs';
import {PROXY_BASE} from './config.mjs';
import {initAuth,isSignedIn,signOut,requestDeviceCode,pollDeviceCode,saveRefreshToken} from './auth.mjs';
import {createTracker} from './tracking.mjs';

const VERSION = '0.1.0';
const BUILD = typeof __SMARTTUBE_BUILD__ === 'string' ? __SMARTTUBE_BUILD__ : 'dev';
const $ = id => document.getElementById(id);
const html = $('html-player');
const provider = new VideoProvider(createSession, undefined, {progressiveOnly: !PROXY_BASE, proxyBase: PROXY_BASE});
const sponsorSession = new SponsorSession();
let hlsPlayer = null, dashPlayer = null;

// The hosted page runs in a sandboxed iframe, so localStorage throws with an
// opaque origin. window.name persists across reloads of the frame and gives the
// app a small synchronous fallback for history and settings.
function nameStore() {
  try { return JSON.parse(window.name || '{}') || {}; } catch (_) { return {}; }
}
const get = (key, fallback) => {
  try { const value = localStorage.getItem(key); if (value !== null) return value; } catch (_) { /* sandboxed */ }
  const bag = nameStore();
  return Object.prototype.hasOwnProperty.call(bag, key) ? bag[key] : fallback;
};
const save = (key, value) => {
  try { localStorage.setItem(key, String(value)); } catch (_) { /* sandboxed */ }
  try { const bag = nameStore(); bag[key] = String(value); window.name = JSON.stringify(bag); } catch (_) { /* ignore */ }
};

let videos = [], generation = 0, current = null, seeking = false, hideTimer, signinTimer = null, tracker = null, trackingRetry = null, trackingAttempts = 0, homeContinuation = null, homeCache = null, homeLoadingMore = false, homeMorePromise = null, homeLoadedAt = 0, homeRefreshPending = false, page = 'home', lastCard = 0, modalReturn = null;
let history = readHistory(get('watchHistory', '[]'));
let sponsorEnabled = get('sponsorEnabled', 'true') !== 'false';
let skipPreset = Number(get('skipPreset', '0'));
if (!SKIP_PRESETS[skipPreset]) skipPreset = 0;
let qualityPreference = Number(get('qualityHeight', PROXY_BASE ? '1080' : '0'));
if ([0, 2160, 1440, 1080, 720, 480, 360, 240, 144].indexOf(qualityPreference) === -1) qualityPreference = 0;

initAuth();
const state = {events: [], version: VERSION};
window.smarttube = {
  version: VERSION,
  build: BUILD,
  diagnostics: () => ({
    ...state,
    page,
    videoId: current ? current.id : null,
    position: current ? position() : 0,
    quality: current ? current.quality : null,
    format: current ? current.selectedFormatId : null,
    client: current ? current.client : null,
    formats: current && current.formats ? current.formats.map(({id, label, height, fps, codec, available}) => ({id, label, height, fps, codec, available})) : [],
    capabilities: mediaCapabilities(),
    device: deviceInfo()
  }),
  segments: () => sponsorSession.segments,
  deviceInfo,
  mediaCapabilities
};

function log(event, detail) {
  state.events.push({at: Date.now(), event, detail: String(detail === undefined ? '' : detail).slice(0, 500)});
  if (state.events.length > 60) state.events.shift();
  try { console.info('[SmartTube VIDAA]', event, detail); } catch (_) { /* no console */ }
}
function sendDebug(event, extra) {
  try {
    if (!PROXY_BASE) return;
    fetch(PROXY_BASE.replace(/\/+$/, '') + '/debug/log', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(Object.assign({event: event, at: new Date().toISOString()}, extra || {}))
    }).catch(function () {});
  } catch (_) {}
}
function status(message) { $('status').textContent = message; }
function focus(element) {
  if (!element) return;
  try { element.focus(); } catch (_) { /* old engines */ }
  try { element.scrollIntoView({block: 'nearest', inline: 'nearest'}); } catch (_) { try { element.scrollIntoView(); } catch (_) {} }
}
function activeNav() { return document.querySelector('.nav-item.active'); }
function playerState() {
  if (!current) return 'NONE';
  if (html.error) return 'ERROR';
  return html.paused ? 'PAUSED' : 'PLAYING';
}
function position() { try { return Number(html.currentTime) || 0; } catch (_) { return 0; } }
function duration() { try { return Number(html.duration) || 0; } catch (_) { return 0; } }
function clock(seconds) {
  const n = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return (n >= 3600 ? Math.floor(n / 3600) + ':' : '') +
    String(Math.floor(n / 60) % 60).padStart(n >= 3600 ? 2 : 1, '0') + ':' +
    String(n % 60).padStart(2, '0');
}
function updateClock() {
  const d = new Date();
  try {
    $('wall-clock').textContent = d.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'});
    $('wall-date').textContent = d.toLocaleDateString('en-US', {weekday: 'short', month: 'short', day: 'numeric'});
  } catch (_) {
    $('wall-clock').textContent = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
    $('wall-date').textContent = d.toDateString();
  }
}
updateClock();
setInterval(updateClock, 30000);

function updateSettings() {
  $('sponsor').textContent = 'SponsorBlock: ' + (sponsorEnabled ? 'On' : 'Off');
  $('sponsor').setAttribute('aria-pressed', String(sponsorEnabled));
  $('skip-options').textContent = 'Skip: ' + SKIP_PRESETS[skipPreset].label;
  $('default-quality').lastElementChild.textContent = qualityPreference ? qualityPreference + 'p maximum' : 'Auto';
  $('version').textContent = 'SmartTube for VIDAA ' + VERSION + ' · ' + BUILD + ' · unofficial';
  $('account').lastElementChild.textContent = isSignedIn() ? 'Signed in' : 'Signed out';
}
$('sponsor').onclick = () => { sponsorEnabled = !sponsorEnabled; save('sponsorEnabled', sponsorEnabled); updateSettings(); };
$('skip-options').onclick = () => { skipPreset = (skipPreset + 1) % SKIP_PRESETS.length; save('skipPreset', skipPreset); updateSettings(); };
$('clear-history').onclick = () => { history = []; save('watchHistory', '[]'); status('Watch history cleared.'); };
updateSettings();

function closeSignIn() {
  clearInterval(signinTimer);
  signinTimer = null;
  $('signin').classList.add('hidden');
}

async function openSignIn() {
  if (isSignedIn()) {
    signOut();
    if (current) stop();
    provider.reset();
    homeCache = null;
    homeLoadedAt = 0;
    homeContinuation = null;
    updateSettings();
    status('Signed out of YouTube.');
    browse('home');
    return;
  }
  if (!PROXY_BASE) {
    status('Account service is not configured in this build.');
    return;
  }
  clearInterval(signinTimer);
  $('signin').classList.remove('hidden');
  $('signin-code').textContent = '…';
  $('signin-status').textContent = 'Requesting a code…';
  try {
    const code = await requestDeviceCode();
    $('signin-code').textContent = code.user_code;
    $('signin-desc').innerHTML = 'Open <b>' + (code.verification_url || 'https://www.google.com/device') +
      '</b> on your phone or computer and enter this code:';
    $('signin-status').textContent = 'Waiting for confirmation…';
    const interval = Math.max(4000, (Number(code.interval) || 5) * 1000);
    const expiresAt = Date.now() + (Number(code.expires_in) || 1800) * 1000;
    signinTimer = setInterval(async () => {
      try {
        if (Date.now() > expiresAt) {
          closeSignIn();
          status('The sign-in code expired. Open the account menu to try again.');
          return;
        }
        const token = await pollDeviceCode(code.device_code);
        if (token.refresh_token) {
          saveRefreshToken(token.refresh_token);
          closeSignIn();
          updateSettings();
          provider.reset();
          homeCache = null;
          homeLoadedAt = 0;
          homeContinuation = null;
          status('Signed in. Loading your recommendations…');
          browse('home');
          return;
        }
        if (token.error && token.error !== 'authorization_pending' && token.error !== 'slow_down') {
          closeSignIn();
          status('Sign-in error: ' + (token.error_description || token.error));
        }
      } catch (error) {
        $('signin-status').textContent = 'Sign-in error: ' + error.message;
      }
    }, interval);
  } catch (error) {
    $('signin-status').textContent = 'Unable to start sign-in: ' + error.message;
  }
}
$('account').onclick = openSignIn;


function render(preserveFocus) {
  const active = document.activeElement;
  const keep = preserveFocus && active && active.classList && active.classList.contains('video-card')
    ? Number(active.dataset.index) : -1;
  $('results').textContent = '';
  videos.forEach((video, index) => {
    const button = document.createElement('button');
    button.className = 'video-card';
    button.dataset.index = index;
    const thumb = document.createElement('span');
    thumb.className = 'thumbnail';
    const img = document.createElement('img');
    img.alt = '';
    const thumbnail = /^\/\//.test(video.thumbnail) ? 'https:' + video.thumbnail : video.thumbnail;
    if (/^https:\/\//.test(thumbnail)) img.src = thumbnail;
    const badge = document.createElement('span');
    badge.className = 'video-duration';
    badge.textContent = video.duration || '';
    if (!video.duration) badge.classList.add('hidden');
    thumb.append(img, badge);
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = video.title;
    const author = document.createElement('span');
    author.className = 'author';
    author.textContent = video.author;
    button.append(thumb, title, author);
    button.onclick = () => { lastCard = index; play(video); };
    $('results').append(button);
  });
  if (keep >= 0 && $('results').children[keep]) focus($('results').children[keep]);
}


async function browse(next) {
  const request = ++generation;
  page = next;
  status('');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  $('search-form').classList.toggle('hidden', page !== 'search');
  $('settings-panel').classList.toggle('hidden', page !== 'settings');
  $('results').classList.toggle('hidden', page === 'settings');
  $('section-title').textContent = {
    home: 'Home', search: 'Search', music: 'Music', gaming: 'Gaming',
    history: 'Watch history', settings: 'Settings'
  }[page];
  videos = [];
  render();
  $('content').scrollTop = 0;
  if (page === 'settings') { updateSettings(); return; }
  if (page === 'history') {
    videos = history;
    render();
    status(videos.length ? '' : 'Videos you play will appear here.');
    return;
  }
  if (page === 'search') { status('Find a video, channel or topic.'); focus($('query')); return; }
  status('Loading…');
  try {
    if (page === 'home') {
      homeContinuation = null;
      let home = homeCache;
      if (!home || Date.now() - home.loadedAt >= HOME_REFRESH_MS) {
        const fresh = await provider.homePage();
        if (request !== generation) return;
        home = {videos: fresh.videos || [], continuation: fresh.continuation || '', loadedAt: Date.now()};
        homeCache = home;
      }
      if (!home.videos.length) {
        const fallback = history.length ? history : await provider.search('popular videos');
        if (request !== generation) return;
        videos = fallback;
        $('section-title').textContent = history.length ? 'Recently watched' : 'Popular videos';
      } else {
        videos = home.videos;
        homeContinuation = home.continuation || '';
        homeLoadedAt = home.loadedAt;
        log('home-page', videos.length + (homeContinuation ? ' +more' : ' end'));
      }
    } else {
      const found = await provider.search(page === 'music' ? 'music' : 'gaming');
      if (request !== generation) return;
      videos = found;
    }
    render();
    status(videos.length ? '' : page === 'home' ? 'Your home feed is empty. Select Search to find something to watch.' : 'No videos found.');
  } catch (error) {
    if (request === generation) {
      status('Unable to load videos. Select Search to try a specific video.');
      log('browse-error', error.message);
    }
  }
}

function loadMoreHome() {
  if (homeMorePromise) return homeMorePromise;
  if (page !== 'home' || current || !homeContinuation) return Promise.resolve(false);
  const token = homeContinuation;
  const request = generation;
  homeLoadingMore = true;
  homeMorePromise = (async () => {
    try {
      const more = await provider.homeMore(token);
      if (page !== 'home' || request !== generation) return false;
      const seen = new Set(videos.map(video => video.id));
      const added = (more.videos || []).filter(video => !seen.has(video.id));
      if (added.length) {
        videos = videos.concat(added);
        homeLoadedAt = Date.now();
        homeCache = {videos: videos.slice(), continuation: more.continuation || '', loadedAt: homeLoadedAt};
        render(true);
      }
      homeContinuation = more.continuation || '';
      log('home-more', added.length + '/' + videos.length + (homeContinuation ? ' more' : ' end'));
      return added.length > 0;
    } catch (error) {
      log('home-more-error', error.message);
      return false;
    }
  })().finally(() => {
    homeMorePromise = null;
    homeLoadingMore = false;
  });
  return homeMorePromise;
}

function maybePrefetchHome(focused) {
  if (page !== 'home' || current || !homeContinuation || homeLoadingMore) return;
  if (!focused || !focused.classList || !focused.classList.contains('video-card')) return;
  if (Number(focused.dataset.index) >= videos.length - 6) loadMoreHome();
}

const HOME_REFRESH_MS = 5 * 60 * 1000;
setInterval(async function () {
  if (homeRefreshPending || !homeCache) return;
  if (Date.now() - homeCache.loadedAt < HOME_REFRESH_MS) return;
  const away = page !== 'home' || !!current;
  if (!away) return;
  if (!$('signin').classList.contains('hidden') || !$('modal').classList.contains('hidden')) return;
  homeRefreshPending = true;
  try {
    const fresh = await provider.homePage();
    if ((page !== 'home' || current) && fresh.videos && fresh.videos.length) {
      homeCache = {videos: fresh.videos, continuation: fresh.continuation || '', loadedAt: Date.now()};
      log('home-refreshed', fresh.videos.length);
    }
  } catch (error) {
    log('home-refresh-error', error.message);
  } finally {
    homeRefreshPending = false;
  }
}, 30000);

async function search(query) {
  if (!query.trim()) { status('Enter a search term.'); focus($('query')); return; }
  const request = ++generation;
  status('Searching…');
  log('search', query);
  try {
    const found = await provider.search(query);
    if (request !== generation) return;
    videos = found;
    render();
    $('section-title').textContent = 'Search results';
    status(videos.length ? '' : 'No videos found. Try another search.');
    focus($('results').firstElementChild);
    log('search-complete', videos.length);
  } catch (error) {
    if (request === generation) { status('Search unavailable: ' + error.message); log('search-error', error.message); }
  }
}
document.querySelectorAll('.nav-item').forEach(b => { b.onclick = () => browse(b.dataset.page); });
$('quick-search').onclick = () => browse('search');
$('search-form').onsubmit = event => { event.preventDefault(); search($('query').value); };

function openMenu(title, description, options, selected, onSelect) {
  modalReturn = document.activeElement;
  $('modal-title').textContent = title;
  $('modal-description').textContent = description;
  $('modal-options').textContent = '';
  options.forEach(option => {
    const b = document.createElement('button');
    b.className = 'format-option' + (option.id === selected ? ' selected' : '');
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(option.id === selected));
    const dot = document.createElement('span');
    dot.className = 'radio';
    const text = document.createElement('span');
    text.textContent = option.label;
    if (option.detail) {
      const detail = document.createElement('span');
      detail.className = 'option-detail';
      detail.textContent = option.detail;
      text.append(detail);
    }
    if (option.available === false) {
      b.setAttribute('aria-disabled', 'true');
      b.classList.add('unavailable');
    }
    b.append(dot, text);
    b.onclick = () => {
      if (option.available === false) return;
      closeMenu();
      onSelect(option);
    };
    $('modal-options').append(b);
  });
  $('modal-options').setAttribute('role', 'radiogroup');
  $('modal').classList.remove('hidden');
  clearTimeout(hideTimer);
  focus($('modal-options').querySelector('.selected') || $('modal-options').firstElementChild);
}
function closeMenu() {
  const target = modalReturn;
  $('modal').classList.add('hidden');
  modalReturn = null;
  if (target && target.isConnected) focus(target);
  if (current) showInfo();
}
$('default-quality').onclick = () => openMenu(
  'Default video quality',
  'Choose a maximum resolution. The closest available format will be used.',
  [0, 2160, 1440, 1080, 720, 480, 360, 240, 144].map(h => ({id: String(h), label: h ? h + 'p maximum' : 'Auto · adaptive quality'})),
  String(qualityPreference),
  option => { qualityPreference = Number(option.id); save('qualityHeight', qualityPreference); updateSettings(); }
);

function streamDetails() {
  return html.videoWidth && html.videoHeight ? html.videoWidth + ' × ' + html.videoHeight : '';
}
function qualityMenu() {
  if (!current || seeking) return;
  const formats = current.formats || [];
  if (!formats.length) { $('player-status').textContent = 'No alternative formats are available.'; showInfo(); return; }
  openMenu(
    'Video format',
    'Available streams for this video.' +
      (streamDetails() ? ' Playing: ' + streamDetails() + '.' : '') +
      (current.live ? ' Live stream.' : ' Your position is kept.'),
    formats.map(f => ({
      ...f,
      label: f.id === 'auto' ? 'Auto · adaptive quality' : (resolutionLabel(f) + ' · ' + codecLabel(f.codec)),
      detail: [
        f.available === false ? (f.unavailableReason || 'Unavailable on this TV') : '',
        f.protocol ? f.protocol.toUpperCase() : '',
        f.bitrate ? (f.bitrate / 1000000).toFixed(2) + ' Mbps' : ''
      ].filter(Boolean).join(' · ')
    })),
    current.selectedFormatId,
    option => changeFormat(formats.find(f => f.id === option.id))
  );
}
$('quality').onclick = qualityMenu;

function showInfo() {
  // Keep remote focus in the app iframe after the video starts or the
  // controls are toggled; otherwise the TV can leave focus on the loader.
  try { if (window.parent !== window) window.parent.postMessage({type: 'smarttube-focus'}, '*'); } catch (_) {}
  $('player-info').classList.remove('dim');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (current && !seeking && $('modal').classList.contains('hidden') && !$('player-controls').contains(document.activeElement)) {
      $('player-info').classList.add('dim');
    }
  }, 5000);
}
function seek(seconds, onSuccess) {
  if (!current || seeking || current.live) return;
  const request = generation;
  const total = duration() || current.duration || seconds;
  const target = Math.max(0, Math.min(seconds, Math.max(0, total - .25)));
  seeking = true;
  const done = () => { if (request === generation) { seeking = false; if (onSuccess) onSuccess(); } };
  const failed = error => { if (request === generation) { seeking = false; log('seek-error', error && error.message ? error.message : error); } };
  try {
    html.currentTime = target;
    done();
  } catch (error) {
    failed(error);
  }
}
function resumeHtml() {
  const request = generation;
  html.play().catch(error => { if (request === generation) failPlayback(error); });
}
function toggle() {
  if (!current) return;
  try {
    if (html.paused) resumeHtml();
    else html.pause();
    showInfo();
  } catch (error) { failPlayback(error); }
}
$('rewind').onclick = () => { seek(position() - 10); showInfo(); };
$('forward').onclick = () => { seek(position() + 10); showInfo(); };
$('play-pause').onclick = toggle;
$('player-back').onclick = () => stop();

function closePlayer() {
  if (dashPlayer) { dashPlayer.destroy(); dashPlayer = null; }
  if (hlsPlayer) { hlsPlayer.destroy(); hlsPlayer = null; }
  html.onloadedmetadata = null;
  try { html.pause(); html.removeAttribute('src'); html.load(); } catch (error) { log('close-error', error.message); }
}
function stopTracking() {
  clearTimeout(trackingRetry);
  trackingRetry = null;
  if (!tracker) return;
  try { tracker.finish(position()); } catch (_) {}
  tracker = null;
}

function startTracking() {
  stopTracking();
  try {
    if (PROXY_BASE) fetch(PROXY_BASE.replace(/\/+$/, '') + '/debug/log', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        event: 'tracking-start', signedIn: isSignedIn(),
        client: current ? current.client : null, videoId: current ? current.id : null,
        attempt: trackingAttempts,
        hasTracking: !!(current && current.tracking),
        method: current && current.tracking ? (current.tracking.mediaInfo ? 'mediaInfo' :
          (current.tracking.videostats_watchtime_url || current.tracking.videostatsWatchtimeUrl ? 'url' : null)) : null,
        addHistory: !!(current && current.tracking && current.tracking.mediaInfo && typeof current.tracking.mediaInfo.addToWatchHistory === 'function'),
        watchtime: !!(current && current.tracking &&
          ((current.tracking.videostatsWatchtimeUrl) || (current.tracking.videostats_watchtime_url)))
      })
    }).catch(function () {});
  } catch (_) {}
  if (!current || !current.tracking) return;
  if (!isSignedIn()) {
    // The access token may still be refreshing right after the app opens.
    // Retry briefly instead of losing the playback record for this video.
    if (trackingAttempts < 30) {
      trackingAttempts += 1;
      trackingRetry = setTimeout(startTracking, 1000);
    }
    return;
  }
  trackingAttempts = 0;
  tracker = createTracker(current.tracking, current.id, current.duration || duration());
  if (tracker) {
    try { tracker.start(position()); } catch (_) {}
    sendDebug('tracking-ready', {videoId: current.id, method: tracker.method || 'unknown'});
  }
}

function stop() {
  stopTracking();
  ++generation;
  current = null;
  sponsorSession.setVideo(null, []);
  seeking = false;
  clearTimeout(hideTimer);
  $('modal').classList.add('hidden');
  modalReturn = null;
  closePlayer();
  $('playback').classList.add('hidden');
  $('browser').classList.remove('hidden');
  document.body.classList.remove('playing');
  if (page === 'home' && homeCache && homeCache.loadedAt > homeLoadedAt) {
    videos = homeCache.videos;
    homeContinuation = homeCache.continuation || '';
    homeLoadedAt = homeCache.loadedAt;
    render();
  }
  focus($('results').children[lastCard] || activeNav());
  log('stopped');
}
function failPlayback(error) {
  try {
    if (PROXY_BASE) {
      fetch(PROXY_BASE.replace(/\/+$/, '') + '/debug/log', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          message: String(error && error.message ? error.message : error).slice(0, 3000),
          videoId: current ? current.id : null,
          client: current ? current.client : null,
          ua: navigator.userAgent.slice(0, 200),
          at: new Date().toISOString()
        })
      }).catch(function () {});
    }
  } catch (_) { /* diagnostics are best effort */ }
  state.lastPlaybackError = {
    code: error && error.dashCode !== undefined ? error.dashCode : null,
    httpStatus: error && error.httpStatus !== undefined ? error.httpStatus : null,
    mediaType: error && error.mediaType !== undefined ? error.mediaType : null,
    position: error && error.position !== undefined ? error.position : null
  };
  log('player-error', error && error.message ? error.message : error);
  stop();
  status('Playback unavailable: ' + (error && error.message ? error.message : error));
}

function startSource(source, options) {
  options = options || {};
  const request = options.request === undefined ? generation : options.request;
  const startPosition = options.startPosition || 0;
  const paused = !!options.paused;
  const onError = options.onError || failPlayback;
  const onReady = options.onReady || function () {};
  const ready = () => {
    if (request !== generation) return;
    seeking = false;
    $('player-status').textContent = source.label || source.quality || 'Auto';
    $('quality-label').textContent = source.height ? resolutionLabel(source) : 'Auto';
    log('playing', source.id || source.quality);
    showInfo();
    onReady();
    try { startTracking(); } catch (trackingError) { log('tracking-error', trackingError.message); }
  };
  const failed = error => { if (request === generation) { seeking = false; onError(error); } };

  html.classList.remove('hidden');
  if (current && current.engine === 'dash') {
    let next;
    try {
      next = createDashPlayer(html, source, {
        isCurrent: () => request === generation,
        startPosition, paused,
        onError: failed,
        onReady: ready,
        onEnded: () => { stop(); status('Video finished.'); },
        onBuffering: () => { $('player-status').textContent = 'Buffering…'; showInfo(); },
        onBuffered: () => { $('player-status').textContent = source.label || source.quality || 'Auto'; }
      }, dashjs);
    } catch (error) { failed(error); return; }
    if (request === generation) dashPlayer = next; else next.destroy();
  } else if (current && current.engine === 'hls') {
    hlsPlayer = createHlsPlayer(html, source, {
      isCurrent: () => request === generation,
      startPosition, paused,
      onError: failed,
      onReady: ready,
      onEnded: () => { stop(); status('Video finished.'); },
      onBuffering: () => { $('player-status').textContent = 'Buffering…'; showInfo(); },
      onBuffered: () => { $('player-status').textContent = source.label || source.quality || 'Auto'; },
      onEvent: (type, data) => {
        if (type === 'HLS_LEVEL_SWITCHED') log('level', data.height + 'p');
        if (type === 'HLS_MANIFEST_PARSED' && current) {
          current.formats = current.formats.map(f => f.protocol === 'hls'
            ? {...f, available: findHlsLevel(data.levels, f) !== null, unavailableReason: 'Codec/format not supported by this TV'}
            : f);
        }
      }
    }, Hls);
  } else {
    html.src = source.url;
    html.onloadedmetadata = () => {
      if (request !== generation) return;
      if (startPosition) html.currentTime = startPosition;
      if (paused) { html.pause(); ready(); }
      else html.play().then(ready).catch(failed);
    };
    html.load();
  }
}

function changeFormat(format) {
  if (!current || !format || format.available === false || format.id === current.selectedFormatId) return;
  const previous = {...current};
  const t = current.live ? 0 : position();
  const paused = playerState() === 'PAUSED';
  const request = ++generation;
  seeking = true;
  let switched = false;
  stopTracking();
  current = null;
  closePlayer();
  current = withFormat(previous, format);
  $('player-status').textContent = 'Changing format…';
  showInfo();
  startSource(format, {
    request, startPosition: t, paused,
    onReady: () => { switched = true; qualityPreference = format.height || 0; save('qualityHeight', qualityPreference); updateSettings(); },
    onError: error => {
      if (switched) { failPlayback(error); return; }
      log('format-error', error && error.message ? error.message : error);
      const restoreRequest = ++generation;
      current = null;
      closePlayer();
      current = previous;
      startSource(previous, {
        request: restoreRequest, startPosition: t, paused,
        onReady: () => { $('player-status').textContent = 'That format could not play. Previous format restored.'; showInfo(); }
      });
    }
  });
}

async function play(video) {
  if (current) stop();
  sendDebug('play-start', {videoId: video.id, signedIn: isSignedIn()});
  const request = ++generation;
  status('Opening ' + video.title + '…');
  log('open', video.id);
  try {
    const source = await provider.playback(video.id);
    if (request !== generation) return;
    source.formats = markFormatSupport(source.formats || [], type => window.MediaSource && window.MediaSource.isTypeSupported ? window.MediaSource.isTypeSupported(type) : false)
      .map(f => ({...f, engine: f.engine === 'av' ? 'html' : (f.engine || (f.protocol === 'hls' && Hls.isSupported() ? 'hls' : 'html'))}));
    const format = preferredFormat(source.formats, qualityPreference);
    if (!format) throw Error('This TV cannot decode the available video/audio codecs.');
    current = withFormat({
      ...video,
      ...source,
      id: video.id,
      engine: source.engine === 'av' ? 'html' : (source.engine || (source.protocol === 'hls' && Hls.isSupported() ? 'hls' : 'html'))
    }, format);
    sendDebug('play-source', {videoId: video.id, client: current.client, signedIn: isSignedIn(),
      hasTracking: !!current.tracking,
      watchtime: !!(current.tracking && ((current.tracking.videostatsWatchtimeUrl) || current.tracking.videostats_watchtime_url))});
    sponsorSession.setVideo(video.id, []);
    $('video-title').textContent = video.title;
    $('player-status').textContent = 'Loading video…';
    $('browser').classList.add('hidden');
    $('playback').classList.remove('hidden');
    document.body.classList.add('playing');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    showInfo();
    const remember = () => { history = rememberVideo(history, video); save('watchHistory', JSON.stringify(history)); };
    startSource(current, {
      request,
      onReady: remember,
      onError: error => {
        const automatic = current && current.formats ? current.formats.find(f => f.id === 'auto') : null;
        if (current && current.engine === 'hls' && current.selectedFormatId !== 'auto' && automatic && error.code === 'UNSUPPORTED_FORMAT') {
          const retry = ++generation;
          const failedSource = current;
          current = null;
          closePlayer();
          current = withFormat(failedSource, automatic);
          startSource(current, {
            request: retry,
            onReady: () => { remember(); $('player-status').textContent = 'Saved format unavailable. Playing Auto.'; showInfo(); }
          });
        } else {
          failPlayback(error);
        }
      }
    });
    if (!source.live && source.duration) {
      provider.segments(video.id, source.duration, SKIP_PRESETS[skipPreset].categories).then(found => {
        if (current && current.id === video.id) { sponsorSession.setVideo(video.id, found); log('segments', found.length); }
      }).catch(error => { if (current && current.id === video.id) log('sponsorblock-error', error.message); });
    }
  } catch (error) {
    if (request === generation) failPlayback(error);
  }
}

html.addEventListener('error', () => {
  if (current && current.engine !== 'hls' && current.engine !== 'dash') failPlayback('The media stream could not be played.');
});
html.addEventListener('ended', () => {
  if (current && current.engine !== 'hls' && current.engine !== 'dash') { stop(); status('Video finished.'); }
});
setInterval(() => {
  if (!current) return;
  const t = position(), d = duration() || current.duration || 0;
  $('timeline').textContent = clock(t) + ' / ' + clock(d);
  $('progress-fill').style.width = Math.max(0, Math.min(100, d ? t / d * 100 : 0)) + '%';
  const actual = streamDetails();
  $('stream-details').textContent = actual ? 'Playing ' + actual : '';
  const playing = playerState() === 'PLAYING';
  $('play-pause').textContent = playing ? 'Pause' : 'Play';
  if (tracker) tracker.tick(t, playing);
  if (!playing || seeking) return;
  const target = sponsorSession.target(t, {enabled: sponsorEnabled, playing, speed: 1});
  if (target !== null) {
    seek(target, () => {
      sponsorSession.confirm(target);
      $('player-status').textContent = 'Segment skipped';
      showInfo();
      log('sponsor-skipped', t + ' → ' + target);
    });
  }
}, 250);

function moveList(items, focused, key) {
  const list = Array.prototype.slice.call(items);
  if (!list.length) return;
  const index = list.indexOf(focused);
  let next = index;
  if (key === 'up' || key === 'left') next = index <= 0 ? 0 : index - 1;
  if (key === 'down' || key === 'right') next = index < 0 ? 0 : Math.min(list.length - 1, index + 1);
  focus(list[next]);
}

function handleRemote(event) {
  const key = normalizeKey(event);
  if (!key) return;
  const focused = document.activeElement;

  if (!$('signin').classList.contains('hidden')) {
    if (key === 'back') { event.preventDefault(); closeSignIn(); }
    return;
  }

  if (!$('modal').classList.contains('hidden')) {
    if (key === 'back') { event.preventDefault(); closeMenu(); return; }
    if (key === 'up' || key === 'down' || key === 'left' || key === 'right') {
      event.preventDefault();
      moveList($('modal-options').children, focused, key);
    }
    return;
  }

  if (current) {
    if (key === 'back') {
      event.preventDefault();
      if ($('player-controls').contains(focused)) { focused.blur(); $('player-info').classList.add('dim'); }
      else stop();
      return;
    }
    if (key === 'playpause') { event.preventDefault(); toggle(); return; }
    if (key === 'select') {
      // OK must activate the highlighted control, not always toggle playback.
      // Buttons keep their native Enter/Space click; only the video/background
      // uses OK as play/pause.
      const control = focused && (focused.tagName === 'BUTTON' || focused.getAttribute('role') === 'button');
      if (control) return;
      event.preventDefault();
      toggle();
      return;
    }
    if (key === 'play') { event.preventDefault(); resumeHtml(); showInfo(); return; }
    if (key === 'pause') { event.preventDefault(); html.pause(); showInfo(); return; }
    if (key === 'stop') { event.preventDefault(); stop(); return; }
    if ($('player-controls').contains(focused)) {
      if (key === 'up') { event.preventDefault(); focused.blur(); $('player-info').classList.add('dim'); return; }
      if (key === 'left' || key === 'right') {
        event.preventDefault();
        const buttons = Array.prototype.slice.call($('player-controls').children);
        const index = buttons.indexOf(focused);
        focus(buttons[Math.max(0, Math.min(buttons.length - 1, index + (key === 'left' ? -1 : 1)))]);
        showInfo();
      }
      return;
    }
    if (key === 'left' || key === 'right') { event.preventDefault(); seek(position() + (key === 'left' ? -10 : 10)); showInfo(); }
    else if (key === 'up' || key === 'down') { event.preventDefault(); showInfo(); focus($('play-pause')); }
    return;
  }

  if (key === 'back') {
    if (page !== 'home' || (focused && focused !== activeNav())) {
      event.preventDefault();
      if (page !== 'home') { browse('home'); focus(activeNav()); }
      else focus(activeNav());
      return;
    }
    // At the home root the installed TV app normally consumes Back itself.
    // Do not preventDefault here: the iframe cannot close the TV app on its
    // own, and the loader can still try the vendor exit helper.
    try {
      if (window.parent !== window) window.parent.postMessage({type: 'smarttube-exit'}, '*');
      else exitApp();
    } catch (_) { /* ignore */ }
    return;
  }
  if (key === 'home') { event.preventDefault(); browse('home'); focus(activeNav()); return; }
  if (key.indexOf('number:') === 0) {
    const index = Number(key.slice(7)) - 1;
    const card = $('results').children[index];
    if (card) { event.preventDefault(); lastCard = index; card.focus(); card.click(); }
    return;
  }
  const direction = key === 'up' || key === 'down' || key === 'left' || key === 'right';
  if (!direction) return;

  if (focused && focused.classList && focused.classList.contains('video-card')) {
    const index = Number(focused.dataset.index);
    const next = gridTarget(index, key, videos.length, 3);
    if (key === 'down' && next === index && page === 'home' && homeContinuation) {
      event.preventDefault();
      const firstNew = videos.length;
      loadMoreHome().then(loaded => {
        const card = loaded && $('results').children[firstNew];
        if (card) { lastCard = firstNew; focus(card); }
      });
      return;
    }
    maybePrefetchHome(focused);
    if (next === 'sidebar') focus(activeNav());
    else if (next === 'header') focus(page === 'search' ? $('query') : activeNav());
    else focus($('results').children[next]);
  } else if (focused && (focused.classList.contains('nav-item') || focused === $('quick-search'))) {
    const nav = [$('quick-search')].concat(Array.prototype.slice.call(document.querySelectorAll('.nav-item')));
    const index = nav.indexOf(focused);
    if (key === 'right') focus(page === 'settings' ? $('default-quality') : page === 'search' ? $('query') : $('results').firstElementChild || activeNav());
    else if (key === 'up' || key === 'down') focus(nav[Math.max(0, Math.min(nav.length - 1, index + (key === 'up' ? -1 : 1)))]);
  } else if (focused && $('settings-panel').contains(focused)) {
    const buttons = Array.prototype.slice.call($('settings-panel').querySelectorAll('button'));
    const index = buttons.indexOf(focused);
    if (key === 'left') focus(activeNav());
    else if (key === 'up' || key === 'down') focus(buttons[Math.max(0, Math.min(buttons.length - 1, index + (key === 'up' ? -1 : 1)))]);
  } else if (focused === $('query')) {
    if (key === 'down') { event.preventDefault(); focus($('results').firstElementChild || $('search')); }
    else if (key === 'up') { event.preventDefault(); focus($('search')); }
  } else if (focused === $('search')) {
    event.preventDefault();
    if (key === 'left') focus($('query'));
    else if (key === 'down') focus($('results').firstElementChild || $('query'));
    else if (key === 'up') focus(activeNav());
  }
}

document.addEventListener('keydown', handleRemote);

// The hosted page runs the app in a sandboxed iframe so the request origin is
// "null" (YouTube's public API accepts it). The loader forwards remote keys
// here when focus is outside the iframe.
window.addEventListener('message', event => {
  const data = event.data;
  if (!data || typeof data !== 'object' || data.type !== 'smarttube-key') return;
  handleRemote({
    key: typeof data.key === 'string' ? data.key : '',
    keyCode: Number(data.keyCode) || 0,
    which: Number(data.which) || 0,
    preventDefault: function () {}
  });
});

// On VIDAA builds that move an on-screen pointer, hovering a control should
// move the visible focus without requiring a click first.
document.addEventListener('mouseover', event => {
  const target = event.target;
  if (!target || !target.closest) return;
  const button = target.closest('button');
  if (!button || button.classList.contains('unavailable')) return;
  if (button !== document.activeElement) {
    try { button.focus({preventScroll: true}); } catch (_) { try { button.focus(); } catch (_) {} }
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && current && !html.paused) {
    try { html.pause(); } catch (_) { /* ignore */ }
  }
});

window.addEventListener('unhandledrejection', event => {
  const reason = event.reason;
  log('unhandled', reason && reason.message ? reason.message : reason);
  status('Error: ' + (reason && reason.message ? reason.message : reason));
});
window.addEventListener('error', event => {
  log('error', event.message);
  status('Error: ' + event.message);
});

try {
  if (PROXY_BASE) fetch(PROXY_BASE.replace(/\/+$/, '') + '/debug/log', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({event: 'hello', version: VERSION, url: location.href,
      signedIn: isSignedIn(), ua: navigator.userAgent.slice(0, 180)})
  }).catch(function () {});
} catch (_) {}
focus(activeNav());
browse('home');
log('ready', deviceInfo());
