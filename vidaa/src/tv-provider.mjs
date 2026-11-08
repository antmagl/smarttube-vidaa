import {YT} from 'youtubei.js/web';
import {timedFetch} from './provider.mjs';
import {createTvSolver} from './tv-solver.mjs';
import {mediaUrl} from './formats.mjs';

// Keep the request profile, timestamp and decipher script from the same TV
// player family. A desktop-player solver cannot decipher these TV URLs.
//
// The TVHTML5 endpoint is picky about the declared device: a Hisense/Vidaa
// client is rejected with "The page needs to be reloaded", while the profile
// used by the YouTube TV app is accepted. The app is still the VIDAA web
// client; this identity only selects a working public TV endpoint.
export const TV_CLIENT_VERSION = '5.20260707';
export const TV_REGION = 'US';
export const VIDAA_USER_AGENT = 'Mozilla/5.0 (Linux; Android 9; VIDAA) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36';
const TV_CLIENT = {
  clientName: 'TVHTML5',
  clientVersion: TV_CLIENT_VERSION,
  deviceMake: 'Samsung',
  deviceModel: 'UKS9800',
  osName: 'Tizen',
  osVersion: '2.4.0',
  userAgent: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 2.4.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/2.4.0 TV Safari/538.1'
};

// Exported so the page parser can be tested without network access.
export function parseTvPage(page) {
  const visitor = page.match(/"visitorData":"([^"]+)"/) ||
    page.match(/"VISITOR_DATA":"([^"]+)"/) ||
    page.match(/"NEW_KID_VISITOR_DATA":"([^"]+)"/);
  const path = page.match(/\/s\/player\/[A-Za-z0-9_-]+\/[A-Za-z0-9_./-]+\.js/);
  return {visitor: visitor ? visitor[1] : '', path: path ? path[0] : ''};
}

export function parsePlayerTimestamp(script) {
  const match = script.match(/(?:signatureTimestamp|sts)\s*:\s*(\d{5,8})/);
  const timestamp = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : 0;
}

export function createTvPlaybackClient({request = timedFetch, solverFactory = createTvSolver, clientVersion = TV_CLIENT_VERSION} = {}) {
  const clientProfile = {...TV_CLIENT, clientVersion};
  let initialization, activeWorker, closed = false, queue = Promise.resolve();

  const text = async url => {
    const response = await request(url, {
      headers: {'User-Agent': VIDAA_USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9'}
    });
    if (!response.ok) throw Error(`YouTube TV initialization failed (HTTP ${response.status}).`);
    return response.text();
  };

  const initialize = () => initialization ??= (async () => {
    // /tv carries the TV configuration (visitor data and player script) in
    // one response. The site root is only a fallback: in the EU it can be a
    // consent landing page without any TV configuration.
    let page = await text('https://www.youtube.com/tv');
    let parsed = parseTvPage(page);
    if (!parsed.visitor || !parsed.path) {
      page = await text('https://www.youtube.com/');
      parsed = parseTvPage(page);
    }
    if (!parsed.visitor) throw Error('YouTube did not supply TV visitor data.');
    if (!parsed.path) throw Error('YouTube TV player script was not found.');
    const script = await text('https://www.youtube.com' + parsed.path);
    const timestamp = parsePlayerTimestamp(script);
    if (!timestamp) throw Error('YouTube TV signature timestamp was not found.');
    return {visitor: parsed.visitor, timestamp, script};
  })().catch(error => { initialization = null; throw error; });

  const resolveVideo = async id => {
    if (closed) throw Error('TV provider stopped.');
    const {visitor, timestamp, script} = await initialize();
    if (closed) throw Error('TV provider stopped.');
    const response = await request('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': TV_CLIENT.userAgent,
        'X-YouTube-Client-Name': '7',
        'X-YouTube-Client-Version': clientVersion,
        'X-Goog-AuthUser': '0',
        'X-Goog-Visitor-Id': visitor
      },
      body: JSON.stringify({
        context: {client: {...clientProfile, hl: 'en', gl: TV_REGION, visitorData: visitor}},
        videoId: id,
        contentCheckOk: true,
        racyCheckOk: true,
        playbackContext: {contentPlaybackContext: {html5Preference: 'HTML5_PREF_WANTS', signatureTimestamp: timestamp}}
      })
    });
    if (!response.ok) throw Error(`YouTube TV metadata failed (HTTP ${response.status}).`);
    const data = await response.json();
    if (closed) throw Error('TV provider stopped.');
    if (data.playabilityStatus?.status !== 'OK') {
      return {playability_status: {status: data.playabilityStatus?.status || 'ERROR', reason: data.playabilityStatus?.reason || 'YouTube did not allow playback.'}};
    }
    try {
      for (const key of ['adaptiveFormats', 'formats']) {
        const decoded = [];
        for (const format of data.streamingData?.[key] || []) {
          if (format.drmFamilies?.length || format.drmTrackType) continue;
          const cipher = format.signatureCipher || format.cipher, raw = format.url || '';
          const needsSolver = !!cipher || /[?&]n=/.test(raw);
          if (needsSolver && !activeWorker) {
            activeWorker = solverFactory();
            await activeWorker.prepare(script);
          }
          try {
            let url;
            if (needsSolver) url = await activeWorker.decipher(raw, cipher);
            else url = mediaUrl(raw);
            const clean = {...format, url};
            delete clean.signatureCipher;
            delete clean.cipher;
            decoded.push(clean);
          } catch (error) {
            if (closed || (activeWorker && activeWorker.stopped)) throw error;
          }
        }
        if (data.streamingData) data.streamingData[key] = decoded;
      }
    } finally {
      if (activeWorker) activeWorker.destroy();
      activeWorker = null;
    }
    if (closed) throw Error('TV provider stopped.');
    const info = new YT.VideoInfo([{data}], undefined, 'vidaa-tv-session');
    // Keep the signed-in watch-history endpoints from the TV player response.
    info.vidaa_tracking = data.playbackTracking || null;
    // URLs are already deciphered. Release the large parser worker before MSE
    // allocates its video/audio buffers, and keep only the resulting strings.
    for (const f of [...(info.streaming_data?.adaptive_formats || []), ...(info.streaming_data?.formats || [])]) f.decipher = async () => f.url;
    return info;
  };

  return {
    async getBasicInfo(id) {
      if (!/^[\w-]{11}$/.test(id)) throw Error('Invalid video ID.');
      if (closed) throw Error('TV provider stopped.');
      const task = queue.then(() => resolveVideo(id));
      queue = task.catch(() => {});
      return task;
    },
    destroy() {
      closed = true;
      if (activeWorker) activeWorker.destroy();
      activeWorker = null;
    }
  };
}
