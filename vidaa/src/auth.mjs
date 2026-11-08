// YouTube TV account state.
//
// The refresh token is stored only in this browser's localStorage on the TV.
// The Worker owns the OAuth client exchange and never stores user tokens.

import {PROXY_BASE} from './config.mjs';

const REFRESH_KEY = 'smarttube_refresh_token';
const DEVICE_KEY = 'smarttube_device_id';
let accessToken = '';
let accessExpiresAt = 0;
let refreshToken = '';
let pendingAccess = null;

function storageGet(key) {
  try { return localStorage.getItem(key) || ''; } catch (_) { return ''; }
}
function storageSet(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch (_) { /* storage is optional */ }
}
function randomId() {
  const bytes = new Uint8Array(16);
  try { crypto.getRandomValues(bytes); } catch (_) {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export function deviceId() {
  let value = storageGet(DEVICE_KEY);
  if (!value) { value = randomId(); storageSet(DEVICE_KEY, value); }
  return value;
}

export function initAuth() {
  refreshToken = storageGet(REFRESH_KEY);
  accessToken = '';
  accessExpiresAt = 0;
}

export function isSignedIn() {
  return !!refreshToken;
}

export function signOut() {
  refreshToken = '';
  accessToken = '';
  accessExpiresAt = 0;
  pendingAccess = null;
  storageSet(REFRESH_KEY, '');
}

export function saveRefreshToken(token) {
  if (!token || typeof token !== 'string') return false;
  refreshToken = token;
  accessToken = '';
  accessExpiresAt = 0;
  storageSet(REFRESH_KEY, token);
  return true;
}

async function workerJson(path, body) {
  if (!PROXY_BASE) throw Error('Account service is not configured.');
  const response = await fetch(PROXY_BASE.replace(/\/+$/, '') + path, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body || {}),
    credentials: 'omit',
    cache: 'no-store'
  });
  let data = {};
  try { data = await response.json(); } catch (_) { data = {}; }
  if (!response.ok && !data.error) throw Error('Account service HTTP ' + response.status);
  return data;
}

export async function requestDeviceCode() {
  const data = await workerJson('/auth/device', {device_id: deviceId()});
  if (!data.device_code || !data.user_code) {
    throw Error(data.error_description || data.error || 'No sign-in code returned.');
  }
  return data;
}

export async function pollDeviceCode(deviceCode) {
  return workerJson('/auth/token', {device_code: deviceCode});
}

export async function getAccessToken() {
  if (!refreshToken) return '';
  if (accessToken && Date.now() < accessExpiresAt - 60000) return accessToken;
  if (pendingAccess) return pendingAccess;
  pendingAccess = (async () => {
    try {
      const data = await workerJson('/auth/refresh', {refresh_token: refreshToken});
      if (data.error) {
        try { console.warn('[SmartTube auth] refresh:', data.error, data.error_description || ''); } catch (_) {}
        if (data.error === 'invalid_grant') signOut();
        return '';
      }
      if (typeof data.access_token !== 'string' || !data.access_token) return '';
      accessToken = data.access_token;
      accessExpiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
      return accessToken;
    } catch (error) {
      try { console.warn('[SmartTube auth] refresh failed:', error.message); } catch (_) {}
      return '';
    }
  })().finally(() => { pendingAccess = null; });
  return pendingAccess;
}
