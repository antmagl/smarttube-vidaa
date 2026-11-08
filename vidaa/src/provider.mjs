import {normalizeVideos, normalizeSegments} from './core.mjs';
import {adaptiveFormats} from './adaptive.mjs';
import {mediaUrl,parseHlsFormats,formatLabel} from './formats.mjs';
import {PROXY_BASE,proxyUrl,isProxyUrl} from './config.mjs';
import {getAccessToken,isSignedIn} from './auth.mjs';

// Metadata/player-script requests only; media is loaded by the selected TV playback engine.
// Buffer with a cap so the deadline includes the response body, not just headers.
export async function timedFetch(input, options = {}, timeoutMs = 18000) {
  const controller = new AbortController();
  const abort=()=>controller.abort();
  if(options.signal?.aborted)abort();
  options.signal?.addEventListener('abort',abort,{once:true});
  const timeout = setTimeout(abort,timeoutMs);
  let reader;
  try {
    // The TV app has no cookies/account state of its own; keep metadata calls
    // anonymous and never reuse a cached response for a signed media URL.
    const response=await fetch(input,{...options,signal:controller.signal,credentials:'omit',cache:'no-store'});
    const chunks=[];let size=0;
    if(response.body){
      reader=response.body.getReader();
      while(true){
        const {done,value}=await reader.read();if(done)break;
        size+=value.byteLength;
        if(size>16*1024*1024)throw Error('Metadata response exceeded 16 MiB.');
        chunks.push(value);
      }
    }
    const bytes=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    const result=new Response([204,205,304].includes(response.status)?null:bytes,
      {status:response.status,statusText:response.statusText,headers:response.headers});
    Object.defineProperty(result,'url',{value:response.url});
    return result;
  }catch(error){abort();throw error;}
  finally { clearTimeout(timeout);options.signal?.removeEventListener('abort',abort);reader?.releaseLock(); }
}

// YouTube's API endpoints answer a cross-origin request only when it is a
// CORS "simple request". Its OPTIONS preflight returns 403, so a JSON
// Content-Type or any X-* header makes the whole call fail with
// "Failed to fetch". Send the JSON body as text/plain and drop non-safelisted
// headers; the client identity is already in the request body.
const SAFE_HEADERS = new Set(['accept', 'accept-language', 'content-language', 'content-type', 'range']);
const YOUTUBE_API = /^https:\/\/(?:www\.youtube\.com|youtubei\.googleapis\.com)\/youtubei\//;
const STATS_API = /^https:\/\/(?:www|s)\.youtube\.com\/api\/stats\//;

export async function apiFetch(input, options = {}) {
  const url = String(typeof input === 'string' ? input : (input && input.url) || input);
  if (STATS_API.test(url)) {
    if (!PROXY_BASE) return timedFetch(input, options);
    const headers = {'Content-Type': 'application/json'};
    const token = await getAccessToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    return timedFetch(proxyUrl(url, PROXY_BASE), {...options, headers});
  }
  if (!YOUTUBE_API.test(url)) return timedFetch(input, options);
  if (PROXY_BASE) {
    // Direct GitHub Pages origin -> Worker -> YouTube. The Worker handles the
    // CORS preflight and forwards the JSON body and Authorization header.
    const incoming = new Headers(options.headers || {});
    const headers = {'Content-Type': 'application/json'};
    // Only forward Authorization when a caller explicitly opts in. The WEB
    // API rejects a YouTube TV token attached to its requests (HTTP 400), so
    // ordinary search/browse stays anonymous.
    const authorization = incoming.get('authorization');
    if (authorization) headers.Authorization = authorization;
    const method = String(options.method || (input && input.method) || 'GET').toUpperCase();
    const proxied = {...options, headers};
    // Some YouTube.js browse calls are GET requests carrying a Request body;
    // browsers reject those before they reach the Worker. Rebuild GET/HEAD
    // calls from the URL string and drop any body.
    if (method === 'GET' || method === 'HEAD') delete proxied.body;
    const response = await timedFetch(proxyUrl(url, PROXY_BASE), {...proxied, method});
    if (!response.ok) {
      try { console.warn('[SmartTube API] HTTP ' + response.status + ' ' + url); } catch (_) {}
    }
    return response;
  }

  // Fallback for the old opaque-iframe build without an API proxy.
  const incoming = new Headers(options.headers || {});
  const headers = {};
  incoming.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (lower !== 'content-type' && SAFE_HEADERS.has(lower)) headers[name] = value;
  });
  headers['Content-Type'] = 'text/plain;charset=UTF-8';
  return timedFetch(input, {...options, headers});
}

function textOf(value){
  if(!value)return '';
  if(typeof value==='string')return value;
  if(typeof value.simpleText==='string')return value.simpleText;
  if(Array.isArray(value.runs))return value.runs.map(r=>r.text||'').join('');
  return '';
}

// YouTube's TV home uses tileRenderer rows. Collect every tile in document
// order (the home response mixes tiles with other renderers, and continuation
// pages can return them under different wrappers) instead of relying on one
// fixed section path.
function walkNodes(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walkNodes(item, visit);
    return;
  }
  if (visit(node) === false) return;
  for (const value of Object.values(node)) walkNodes(value, visit);
}

function textNode(value) {
  return textOf(value);
}

function videoFromTile(tile) {
  const id = tile?.onSelectCommand?.watchEndpoint?.videoId ||
    tile?.onSelectCommand?.reelWatchEndpoint?.videoId;
  if (!/^[\w-]{11}$/.test(id || '')) return null;
  const meta = tile?.metadata?.tileMetadataRenderer;
  const header = tile?.header?.tileHeaderRenderer;
  const thumbs = header?.thumbnail?.thumbnails || [];
  return {
    id,
    title: textNode(meta?.title) || textNode(header?.title) || 'Untitled video',
    author: {name: textNode(meta?.lines?.[0]?.lineRenderer?.items?.[0]?.lineItemRenderer?.text)},
    thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : '',
    duration: textNode(header?.thumbnailOverlays?.[0]?.thumbnailOverlayTimeStatusRenderer?.text)
  };
}

function videoFromRenderer(renderer) {
  const id = renderer?.videoId;
  if (!/^[\w-]{11}$/.test(id || '')) return null;
  const thumbs = renderer?.thumbnail?.thumbnails || [];
  return {
    id,
    title: textNode(renderer?.title) || 'Untitled video',
    author: {name: textNode(renderer?.ownerText) || textNode(renderer?.longBylineText) || ''},
    thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : '',
    duration: textNode(renderer?.lengthText)
  };
}

export function tvHomeVideos(data) {
  const found = [];
  walkNodes(data, node => {
    const video = videoFromTile(node.tileRenderer) ||
      videoFromRenderer(node.videoRenderer) ||
      videoFromRenderer(node.compactVideoRenderer) ||
      videoFromRenderer(node.gridVideoRenderer);
    if (video) found.push(video);
  });
  const seen = new Set();
  return found.filter(video => {
    if (seen.has(video.id)) return false;
    seen.add(video.id);
    return true;
  });
}

// Breadth-first search favours the section-list continuation over the many
// per-shelf continuations, which is what a single vertical grid needs.
export function tvHomeContinuation(data) {
  const queue = [data];
  const seen = new Set();
  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node)) continue;
    seen.add(node);
    const candidates = [
      node.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token,
      node.continuationCommand?.token,
      node.nextContinuationData?.continuation,
      node.continuationEndpoint?.continuationCommand?.token
    ];
    for (const token of candidates) {
      if (typeof token === 'string' && token) return token;
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') queue.push(value);
    }
  }
  return '';
}


function trackingFor(info, clientName) {
  if (!info) return null;
  if (info.vidaa_tracking) return info.vidaa_tracking;
  // YouTube.js exposes the parsed player response and cpn publicly. Prefer
  // the raw playbackTracking URLs: this includes the playback record URL that
  // MediaInfo.addToWatchHistory() needs, and lets us control throttling.
  try {
    const page = info.page && info.page[0];
    const tracking = page && page.playback_tracking;
    if (tracking) return {...tracking, cpn: info.cpn};
  } catch (_) { /* fall through to the MediaInfo methods */ }
  if (typeof info.updateWatchTime === 'function') return {mediaInfo: info, client: clientName};
  return null;
}

export class VideoProvider {
  constructor(create, request = timedFetch, options = {}) {
    this.create=create;
    this.request=request;
    this.session=null;
    // The GitHub Pages port plays combined MP4 through a plain <video>.
    // Segmented HLS/DASH needs CORS on googlevideo.com, which the public
    // media hosts do not grant to arbitrary web origins.
    this.progressiveOnly=!!options.progressiveOnly;
    this.proxyBase=options.proxyBase || '';
    this.anonymousHome=null;
  }
  reset() { this.session=null; this.anonymousHome=null; }
  async client() {
    if(!this.session) this.session=this.create().catch(e=>{this.session=null; throw e;});
    return this.session;
  }
  async search(query) {
    if (!query.trim()) return [];
    const client=await this.client();
    const result=await client.search(query.trim(),{type:'video'});
    return normalizeVideos(result.videos).slice(0,32);
  }
  async home(){
    const page=await this.homePage();
    return page.videos;
  }

  async homePage(){
    const client=await this.client();
    if(isSignedIn()){
      try{
        const signed=await this.signedHomePage(client);
        if(signed.videos.length){
          this.anonymousHome=null;
          return signed;
        }
      }catch(error){
        // Never let a TV-token/API mismatch hide the normal home feed.
        try{console.warn('[SmartTube VIDAA] signed home unavailable:',error&&error.message?error.message:error);}catch(_){}
      }
    }
    const feed=await client.getHomeFeed();
    this.anonymousHome=feed;
    return {
      videos:normalizeVideos(feed.videos),
      continuation:feed.has_continuation?'anonymous':''
    };
  }

  async homeMore(continuation){
    if(!continuation)return {videos:[],continuation:''};
    if(continuation==='anonymous'){
      if(!this.anonymousHome)return {videos:[],continuation:''};
      const feed=await this.anonymousHome.getContinuation();
      this.anonymousHome=feed;
      return {
        videos:normalizeVideos(feed.videos),
        continuation:feed.has_continuation?'anonymous':''
      };
    }
    const client=await this.client();
    return this.signedHomePage(client,continuation);
  }

  async signedHomePage(client,continuation){
    const token=await getAccessToken();
    if(!token)throw Error('Not signed in');
    const context=(client.session&&client.session.context&&client.session.context.client)||{};
    const visitor=context.visitorData||context.visitor_data||'';
    const version='7.20241126.01.00';
    const body={
      context:{client:{clientName:'TVHTML5',clientVersion:version,hl:'en',gl:'US',
        ...(visitor?{visitorData:visitor}:{})}},
      ...(continuation?{continuation}:{browseId:'default'})
    };
    const headers={Authorization:'Bearer '+token};
    if(visitor)headers['X-Goog-Visitor-Id']=visitor;
    headers['X-YouTube-Client-Name']='7';
    headers['X-YouTube-Client-Version']=version;
    const response=await apiFetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false',{
      method:'POST',headers,body:JSON.stringify(body)
    });
    if(!response.ok){
      let text='';
      try{text=(await response.text()).slice(0,300);}catch(_){}
      try{console.warn('[SmartTube TV home] HTTP '+response.status+' '+text);}catch(_){}
      throw Error('TV home HTTP '+response.status);
    }
    const data=await response.json();
    const videos=normalizeVideos(tvHomeVideos(data));
    const next=tvHomeContinuation(data);
    if(!videos.length&&!next)try{console.warn('[SmartTube TV home] response had no tileRenderer videos');}catch(_){}
    return {videos,continuation:next};
  }
  async playback(id) {
    if(!/^[\w-]{11}$/.test(id)) throw Error('Invalid video ID.');
    const client=await this.client();
    let lastError='YouTube did not supply a playable stream.',lastClient='',fallback=null;const failures=[];
    // Android is the client that still exposes a combined 360p/240p MP4
    // with a direct URL on the public endpoint. It is the only format a
    // browser can play without CORS or a media proxy. Other profiles are
    // kept as fallbacks; VISIONOS/IOS return HLS, which the TV browser
    // cannot fetch from googlevideo without CORS.
    const signed=isSignedIn();
    const clientOrder=this.progressiveOnly?['ANDROID','ANDROID_VR','VISIONOS','IOS','TV']:
      (signed?['TV','TV7','VISIONOS','IOS','ANDROID','ANDROID_VR']:
        (this.proxyBase?['VISIONOS','IOS','ANDROID','ANDROID_VR','TV']:['VISIONOS','IOS','ANDROID_VR','TV']));
    for(const clientName of clientOrder) {
      lastClient=clientName;
      let info;
      try{info=await client.getBasicInfo(id,{client:clientName});}catch(error){
        lastError=error?.message||String(error);
        failures.push(clientName+': '+lastError);
        try{console.warn('[SmartTube playback]',clientName,lastError);}catch(_){}
        // Try the other clients as well: a signed TV request may fail while a
        // public client still has a playable stream, and vice versa.
        continue;
      }
      const state=info.playability_status?.status;
      if(state!=='OK') {
        lastError=info.playability_status?.reason || 'YouTube did not allow playback.';
        failures.push(clientName+': '+state+' '+lastError);
        try{console.warn('[SmartTube playback]',clientName,state,lastError);}catch(_){}
        continue;
      }
      const data=info.streaming_data || {};
      if(this.progressiveOnly){
        const compatible=(data.formats || []).filter(f=>f.has_video&&f.has_audio&&f.mime_type?.startsWith('video/mp4'));
        if(!compatible.length){lastError='YouTube supplied no combined MP4 stream for this video.';continue;}
        const choices=[];
        for(const f of compatible){
          try{
            const url=mediaUrl(await f.decipher(client.session?.player));
            const choice={id:'mp4-'+(f.itag ?? choices.length),url,protocol:'mp4',engine:'html',height:f.height || 0,
              fps:f.fps || 0,codec:f.mime_type?.match(/codecs="([^"]+)"/)?.[1] || '',bitrate:f.bitrate || 0};
            choice.label=formatLabel(choice);
            choices.push(choice);
          }catch{/* Skip a malformed or inaccessible combined stream. */}
        }
        if(!choices.length){lastError='YouTube supplied no playable combined MP4 stream for this video.';continue;}
        choices.sort((a,b)=>(b.height || 0)-(a.height || 0)||(b.fps || 0)-(a.fps || 0)||
          (b.bitrate || 0)-(a.bitrate || 0)||Number(/avc/i.test(b.codec))-Number(/avc/i.test(a.codec)));
        const selected=choices[0];
        return {...selected,formats:choices,selectedFormatId:selected.id,client:clientName,
          title:info.basic_info?.title || '',duration:info.basic_info?.duration || 0,
          quality:selected.label,live:!!info.basic_info?.is_live,
          tracking:trackingFor(info,clientName)};
      }
      const manifest=data.hls_manifest_url || data.dash_manifest_url;
      const protocol=data.hls_manifest_url?'hls':'dash';
      let formats=[],formatsError;
      if(manifest){
        const direct=mediaUrl(manifest);
        const url=this.proxyBase?proxyUrl(direct,this.proxyBase):direct;
        formats=[{id:'auto',label:'Auto · '+protocol.toUpperCase(),url,protocol,height:0,fps:0,codec:'',bitrate:0}];
        if(protocol==='hls')try{
          const response=await this.request(url);
          if(!response.ok)throw Error('Playlist request failed ('+response.status+').');
          formats=parseHlsFormats(await response.text(),url,this.proxyBase?(value=>isProxyUrl(value,this.proxyBase)):undefined);
        }catch{formatsError='Quality list unavailable; automatic playback remains available.';}
      }else{
        if(!info.basic_info?.is_live)formats=await adaptiveFormats(data.adaptive_formats || [],client.session?.player,Number(info.basic_info?.duration));
        if(this.proxyBase)formats=formats.map(f=>f.video&&f.audio?{
          ...f,video:{...f.video,url:proxyUrl(f.video.url,this.proxyBase)},
          audio:{...f.audio,url:proxyUrl(f.audio.url,this.proxyBase)}}:f);
        const progressive=(data.formats || []).filter(f=>f.has_video&&f.has_audio&&f.mime_type?.startsWith('video/mp4'))
          .sort((a,b)=>(b.height || 0)-(a.height || 0));
        if(!progressive.length&&!formats.length){
          lastError=data.server_abr_streaming_url?'This stream requires SABR playback, which is not implemented yet.':
            'YouTube supplied no compatible HLS, DASH or combined MP4 stream.';
          continue;
        }
        for(const f of progressive){
          const url=mediaUrl(await f.decipher(client.session?.player));
          const choice={id:'mp4-'+(f.itag ?? formats.length),url,protocol:'mp4',engine:'av',video:undefined,audio:undefined,height:f.height || 0,
            fps:f.fps || 0,codec:f.mime_type?.match(/codecs="([^"]+)"/)?.[1] || '',bitrate:f.bitrate || 0};
          choice.label=formatLabel(choice);formats.push(choice);
        }
      }
      if(fallback)for(const f of fallback.formats)if(!formats.some(choice=>choice.id===f.id))formats.push(f);
      const selected=formats[0];
      const source={...selected,formats,selectedFormatId:selected.id,formatsError,client:clientName,
        title:info.basic_info?.title || '',duration:info.basic_info?.duration || 0,
        quality:selected.label,live:!!info.basic_info?.is_live,
        tracking:trackingFor(info,clientName)};
      if(this.proxyBase)source.allowProxy=value=>isProxyUrl(value,this.proxyBase);
      if(selected.protocol==='mp4'){fallback ??= source;continue;}
      return source;
    }
    if(fallback)return fallback;
    throw Error(lastError + (lastClient?' ['+lastClient+']':'') + (failures.length?' · '+failures.join(' | '):''));
  }
  async segments(id,duration,categories=['sponsor']) {
    if(!/^[\w-]{11}$/.test(id)) throw Error('Invalid video ID.');
    const url='https://sponsor.ajay.app/api/skipSegments?videoID='+encodeURIComponent(id)+
      '&categories='+encodeURIComponent(JSON.stringify(categories));
    const response=await this.request(url);
    if(response.status===404) return [];
    if(!response.ok) throw Error('SponsorBlock unavailable ('+response.status+').');
    return normalizeSegments(await response.json(),categories,duration || Infinity);
  }
}
