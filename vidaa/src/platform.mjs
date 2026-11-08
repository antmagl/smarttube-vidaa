// VIDAA / Hisense platform helpers.
//
// The web app runs in the "odin" browser on VIDAA TVs. Depending on firmware
// it is Chromium 77-111. The TV remote is exposed as normal keydown events on
// some builds and as an on-screen pointer plus click on others, so the UI
// supports both. This module keeps the vendor-specific bits out of the app.

const BACK_CODES = [8, 27, 461, 10009];
const PLAY_PAUSE_CODES = [179];
const PLAY_CODES = [415];
const PAUSE_CODES = [19];
const STOP_CODES = [178, 413];

function code(event) {
  return Number(event && (event.keyCode || event.which)) || 0;
}

// Return a small, platform-independent action name. Unknown keys return null
// so the browser keeps its normal behaviour.
export function normalizeKey(event) {
  if (!event) return null;
  const key = String(event.key || '');
  const lower = key.toLowerCase();
  const keyCode = code(event);

  if (key === 'ArrowUp' || keyCode === 38) return 'up';
  if (key === 'ArrowDown' || keyCode === 40) return 'down';
  if (key === 'ArrowLeft' || keyCode === 37) return 'left';
  if (key === 'ArrowRight' || keyCode === 39) return 'right';
  if (key === 'Enter' || key === 'NumpadEnter' || key === 'Select' || key === 'OK' || keyCode === 13) return 'select';

  if (BACK_CODES.indexOf(keyCode) !== -1) return 'back';
  if (['escape', 'backspace', 'browserback', 'goback', 'back'].indexOf(lower) !== -1) return 'back';

  if (PLAY_PAUSE_CODES.indexOf(keyCode) !== -1) return 'playpause';
  if (['mediaplaypause', 'playpause'].indexOf(lower) !== -1) return 'playpause';
  if (PLAY_CODES.indexOf(keyCode) !== -1) return 'play';
  if (['mediaplay', 'play'].indexOf(lower) !== -1) return 'play';
  if (PAUSE_CODES.indexOf(keyCode) !== -1) return 'pause';
  if (['mediapause', 'pause'].indexOf(lower) !== -1) return 'pause';
  if (STOP_CODES.indexOf(keyCode) !== -1) return 'stop';
  if (lower === 'mediastop' || lower === 'stop') return 'stop';

  if (lower === 'home' || key === '0') return 'home';
  if (/^[1-9]$/.test(key)) return 'number:' + key;
  return null;
}

export function isBack(event) {
  return normalizeKey(event) === 'back';
}

// Leave the web app. The TV normally consumes Back itself and returns to the
// launcher, so this is only the in-page fallback for builds that deliver the
// key to JavaScript. Do not navigate away from the page: a blank page is a
// worse result than a no-op.
export function exitApp() {
  const candidates = ['Hisense_FinishApp', 'Hisense_ExitApp', 'Hisense_CloseApp'];
  for (const name of candidates) {
    try {
      if (typeof window[name] === 'function') {
        window[name]();
        return true;
      }
    } catch (_) { /* try the next vendor function */ }
  }
  try {
    window.close();
    return true;
  } catch (_) {
    return false;
  }
}

function callVendor(name) {
  try {
    if (typeof window[name] === 'function') return window[name]();
  } catch (_) { /* vendor functions are optional */ }
  return undefined;
}

function parseVendorObject(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (_) { return value; }
}

// Best-effort device information for the diagnostics panel. It never blocks
// startup and never sends anything to a server.
export function deviceInfo() {
  const info = {
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: navigator.platform,
    screen: (window.screen && window.screen.width && window.screen.height)
      ? window.screen.width + 'x' + window.screen.height : '',
    viewport: window.innerWidth + 'x' + window.innerHeight,
    pixelRatio: window.devicePixelRatio || 1
  };
  const websdk = callVendor('WebSDK_getParam');
  if (websdk !== undefined) {
    try { info.webSDK = parseVendorObject(window.WebSDK_getParam('deviceInfo')); } catch (_) { /* ignore */ }
  }
  const fields = {
    model: 'Hisense_GetModelName',
    firmware: 'Hisense_GetFirmWareVersion',
    chipset: 'Hisense_GetChipSetName',
    os: 'Hisense_GetOSVersion',
    brand: 'Hisense_GetBrand',
    panel: 'Hisense_GetPanelResolution',
    region: 'Hisense_GetRegion'
  };
  for (const field of Object.keys(fields)) {
    const value = callVendor(fields[field]);
    if (value !== undefined) info[field] = parseVendorObject(value);
  }
  return info;
}

// The TV's browser does not expose the Tizen/AVPlay APIs. This helper exists
// so diagnostics can say which playback path is expected.
export function mediaCapabilities() {
  const result = {
    mediaSource: typeof window.MediaSource !== 'undefined',
    video: !!document.createElement('video'),
    h264: false,
    aac: false
  };
  try {
    if (result.mediaSource && window.MediaSource.isTypeSupported) {
      result.h264 = window.MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"');
      result.aac = window.MediaSource.isTypeSupported('audio/mp4; codecs="mp4a.40.2"');
    }
  } catch (_) { /* older engines can throw here */ }
  return result;
}
