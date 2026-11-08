import {Innertube,Platform,Player,Constants} from 'youtubei.js/web';
import {apiFetch,timedFetch} from './provider.mjs';
import {createTvPlaybackClient} from './tv-provider.mjs';
import {getAccessToken} from './auth.mjs';
import {PROXY_BASE,proxyUrl} from './config.mjs';

// The player decipher script is retrieved by YouTube.js from YouTube itself.
Platform.shim.eval=async data=>new Function(data.output)();
// Avoid YouTube.js calling randomUUID on older TV web engines.
Platform.shim.uuidv4=()=> '10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>
  (Number(c)^crypto.getRandomValues(new Uint8Array(1))[0]&15>>Number(c)/4).toString(16));

// VIDAA TVs are sold in many regions. Keep the request's content region in
// sync with the browser language when it carries a two-letter country code,
// otherwise fall back to a neutral default.
export function contentRegion(language = (typeof navigator !== 'undefined' && navigator.language) || 'en-US') {
  const match = String(language).match(/[-_]([A-Za-z]{2})\b/);
  return match ? match[1].toUpperCase() : 'US';
}

// YouTube's /sw.js_data session endpoint has no CORS headers. A web app
// hosted on GitHub Pages cannot read it, and the browser reports
// "Failed to fetch". The public /youtubei/v1/search endpoint does allow an
// opaque ("null") origin, so use one small search to obtain a server-issued
// visitor ID. That visitor ID avoids the bot checks that a purely random
// local session triggers on some videos.
export async function bootstrapVisitor(request = apiFetch) {
  const body = {
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: (Constants && Constants.CLIENTS && Constants.CLIENTS.WEB && Constants.CLIENTS.WEB.VERSION) || '2.20260623.01.00',
        hl: 'en',
        gl: contentRegion()
      }
    },
    query: 'youtube'
  };
  try {
    const response = await request('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body)
    });
    if (!response.ok) return '';
    const data = await response.json();
    const visitor = data && data.responseContext && data.responseContext.visitorData;
    return typeof visitor === 'string' ? visitor : '';
  } catch (_) {
    return '';
  }
}


// TV playback requests must be signed when the user has an account; YouTube
// otherwise returns "Sign in to confirm you're not a bot". They also need to
// go through the Worker for CORS (the /tv page and player script are not
// readable directly from a GitHub Pages origin).
async function tvRequest(input, options = {}) {
  const url = String(typeof input === 'string' ? input : (input && input.url) || input);
  const headers = {};
  new Headers(options.headers || {}).forEach((value, name) => { headers[name] = value; });
  const token = await getAccessToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  return timedFetch(PROXY_BASE ? proxyUrl(url, PROXY_BASE) : url, {...options, headers});
}

export function withTvPlayback(client,{createTv=()=>createTvPlaybackClient({request:tvRequest}),loadLegacyPlayer=()=>Player.create(undefined,timedFetch)}={}){
  const original=client.getBasicInfo.bind(client);
  let tv,tv7,legacy;
  client.getBasicInfo=async(id,options)=>{
    if(options?.client==='TV'){tv??=createTv();return tv.getBasicInfo(id);}
    if(options?.client==='TV7'){tv7??=createTv({clientVersion:'7.20201103.00.00'});return tv7.getBasicInfo(id);}
    const info=await original(id,options);
    const formats=[...(info.streaming_data?.formats||[]),...(info.streaming_data?.adaptive_formats||[])];
    if(!client.session.player&&formats.some(f=>f.signature_cipher||f.cipher||/[?&]n=/.test(f.url||''))){
      legacy??=loadLegacyPlayer().catch(e=>{legacy=null;throw e;});
      client.session.player=await legacy;
    }
    return info;
  };
  client.destroyPlayback=()=>{tv?.destroy();tv=null;tv7?.destroy();tv7=null;};
  return client;
}

export const createSession=async()=>{
  const visitor=await bootstrapVisitor();
  return withTvPlayback(await Innertube.create({
    lang:'en',
    location:contentRegion(),
    ...(visitor?{visitor_data:visitor}:{}),
    // Do not call /sw.js_data: it is not CORS-readable from a third-party
    // origin. The bootstrap visitor above supplies the real identity instead.
    generate_session_locally:true,
    fail_fast:true,
    retrieve_player:false,
    retrieve_innertube_config:false,
    fetch:apiFetch
  }));
};
