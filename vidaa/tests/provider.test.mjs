import test from 'node:test';
import assert from 'node:assert/strict';
import {VideoProvider} from '../src/provider.mjs';
import {timedFetch} from '../src/provider.mjs';
import {createServer} from 'node:http';

test('YouTube sign-in rejection is surfaced before selecting a stream', async () => {
 const provider=new VideoProvider(async()=>({getBasicInfo:async()=>({playability_status:{status:'LOGIN_REQUIRED',reason:'Sign in to confirm you’re not a bot'}})}));
 await assert.rejects(provider.playback('aqz-KE-bpKQ'),/Sign in to confirm/);
});
test('search rejects empty queries without sending a network request',async()=>{
 const p=new VideoProvider(async()=>{throw new Error('network should not be called');});
 assert.deepEqual(await p.search('   '),[]);
});
test('a failed session can be retried',async()=>{
 let attempts=0;
 const p=new VideoProvider(async()=>{if(++attempts===1)throw Error('offline');return {search:async()=>({videos:[]})};});
 await assert.rejects(p.search('bunny'),/offline/);
 assert.deepEqual(await p.search('bunny'),[]);
});
test('SponsorBlock no-segments response is a normal empty result',async()=>{
 const p=new VideoProvider(null,async()=>new Response('',{status:404}));
 assert.deepEqual(await p.segments('aqz-KE-bpKQ',100),[]);
});
test('playback accepts only HTTPS Google media hosts',async()=>{
 const p=new VideoProvider(async()=>({session:{},getBasicInfo:async()=>({
  playability_status:{status:'OK'},basic_info:{},streaming_data:{formats:[{
   has_video:true,has_audio:true,mime_type:'video/mp4',decipher:async()=> 'http://evil.example/video'
  }]}
 })}));
 await assert.rejects(p.playback('aqz-KE-bpKQ'),/Untrusted/);
});

test('Tizen can use an HLS manifest when no progressive format exists',async()=>{
 const seen=[];
 const p=new VideoProvider(async()=>({session:{},getBasicInfo:async(id,{client})=>{
  seen.push(client); return {playability_status:{status:'OK'},basic_info:{title:'Bunny'},
    streaming_data:{hls_manifest_url:'https://manifest.googlevideo.com/example.m3u8'}};
 }}),async()=>new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1920x1080,CODECS="avc1.64002a,mp4a.40.2"\n1080.m3u8\n'));
 const result=await p.playback('aqz-KE-bpKQ');
 assert.equal(result.protocol,'hls');assert.equal(result.url,'https://manifest.googlevideo.com/example.m3u8');
 assert.equal(seen[0],'VISIONOS');
 assert.equal(result.selectedFormatId,'auto');assert.equal(result.formats[1].height,1080);
});
test('compatibility fallback tries every client and reports the last challenge',async()=>{
 const seen=[];
 const p=new VideoProvider(async()=>({getBasicInfo:async(id,{client})=>{
  seen.push(client);return {playability_status:client==='VISIONOS'?{status:'UNPLAYABLE',reason:'Reload required'}:
    {status:'LOGIN_REQUIRED',reason:'Sign in to confirm you’re not a bot'}};
 }}));
 await assert.rejects(p.playback('aqz-KE-bpKQ'),/Sign in to confirm/);
 assert.deepEqual(seen,['VISIONOS','IOS','ANDROID_VR','TV']);
});
test('network deadline covers a response body that stalls after headers',async()=>{
 const server=createServer((request,response)=>{response.writeHead(200,{'Content-Type':'text/plain'});response.flushHeaders();response.write('partial');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  await assert.rejects(async()=>{
   const response=await timedFetch(`http://127.0.0.1:${server.address().port}`,{},50);
   await Promise.race([response.text(),new Promise((_,reject)=>setTimeout(()=>reject(Error('body timeout was not enforced')),250))]);
  },error=>error.name==='AbortError');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});


test('home returns real normalized feed videos without synthetic recommendations',async()=>{
 const p=new VideoProvider(async()=>({getHomeFeed:async()=>({videos:[{id:'aqz-KE-bpKQ',title:'Bunny'},{id:'invalid'}]})}));
 const videos=await p.home();assert.equal(videos.length,1);assert.equal(videos[0].title,'Bunny');
});

test('combined MP4 fallback exposes every playable quality without video-only formats',async()=>{
 const p=new VideoProvider(async()=>({session:{},getBasicInfo:async()=>({playability_status:{status:'OK'},basic_info:{},streaming_data:{formats:[
  {itag:18,has_video:true,has_audio:true,height:360,mime_type:'video/mp4; codecs="avc1.42001E, mp4a.40.2"',decipher:async()=> 'https://video.googlevideo.com/360'},
  {itag:22,has_video:true,has_audio:true,height:720,mime_type:'video/mp4; codecs="avc1.64001F, mp4a.40.2"',decipher:async()=> 'https://video.googlevideo.com/720'},
  {itag:137,has_video:true,has_audio:false,height:1080,mime_type:'video/mp4',decipher:async()=>{throw Error('must not offer silent video');}}
 ]}})}));
 const source=await p.playback('aqz-KE-bpKQ');assert.equal(source.selectedFormatId,'mp4-22');
 assert.deepEqual(source.formats.map(f=>f.height),[720,360]);assert.match(source.quality,/720p/);
});

test('quality list failure retains the already validated automatic master stream',async()=>{
 const p=new VideoProvider(async()=>({getBasicInfo:async()=>({playability_status:{status:'OK'},streaming_data:{hls_manifest_url:'https://manifest.googlevideo.com/master'}})}),async()=>{throw Error('offline');});
 const source=await p.playback('aqz-KE-bpKQ');assert.equal(source.selectedFormatId,'auto');assert.equal(source.formats.length,1);assert.match(source.formatsError,/unavailable/);
});

test('a 360p combined stream does not stop discovery of later adaptive resolutions',async()=>{
 const seen=[];
 const make=(itag,video)=>({itag,has_video:video,has_audio:!video,height:video?1080:0,width:1920,fps:30,bitrate:video?4000000:128000,
  mime_type:video?'video/mp4; codecs="avc1.640028"':'audio/mp4; codecs="mp4a.40.2"',init_range:{start:0,end:600},index_range:{start:601,end:1000},decipher:async()=> 'https://video.googlevideo.com/'+itag});
 const p=new VideoProvider(async()=>({session:{},getBasicInfo:async(id,{client})=>{seen.push(client);return {
  playability_status:{status:'OK'},basic_info:{duration:120},streaming_data:client==='IOS'?{adaptive_formats:[make(137,true),make(140,false)]}:{formats:[
   {itag:18,has_video:true,has_audio:true,height:360,fps:30,mime_type:'video/mp4',decipher:async()=> 'https://video.googlevideo.com/360'}]}};}}));
 const source=await p.playback('aqz-KE-bpKQ');assert.equal(source.engine,'dash');assert.equal(source.height,1080);assert.equal(source.audio.itag,140);
 assert.deepEqual(seen,['VISIONOS','IOS']);
});
test('a playable progressive fallback survives later metadata failure without endless retries',async()=>{
 let count=0;
 const p=new VideoProvider(async()=>({session:{},getBasicInfo:async()=>{if(++count>1)throw Error('offline');return {
  playability_status:{status:'OK'},streaming_data:{formats:[{itag:18,has_video:true,has_audio:true,height:360,mime_type:'video/mp4',decipher:async()=> 'https://video.googlevideo.com/360'}]}};}}));
 const source=await p.playback('aqz-KE-bpKQ');assert.equal(source.height,360);assert.equal(count,4);
});

test('adaptive discovery keeps combined MP4 fallbacks from earlier clients',async()=>{
 const {markFormatSupport}=await import('../src/adaptive.mjs');
 const {preferredFormat,withFormat}=await import('../src/ui-state.mjs');
 const make=(itag,video)=>({itag,has_video:video,has_audio:!video,height:video?1080:0,width:1920,fps:30,bitrate:100000,
 mime_type:video?'video/webm; codecs="vp9"':'audio/webm; codecs="opus"',init_range:{start:0,end:600},index_range:{start:601,end:1000},decipher:async()=> 'https://video.googlevideo.com/'+itag});
 const p=new VideoProvider(async()=>({session:{},getBasicInfo:async(id,{client})=>({playability_status:{status:'OK'},basic_info:{duration:120},streaming_data:client==='VISIONOS'?{formats:[{itag:18,has_video:true,has_audio:true,height:360,mime_type:'video/mp4',decipher:async()=> 'https://video.googlevideo.com/360'}]}:{adaptive_formats:[make(248,true),make(251,false)]}})}));
 const source=await p.playback('aqz-KE-bpKQ');
 const choice=preferredFormat(markFormatSupport(source.formats,()=>false));assert.equal(choice?.id,'mp4-18');assert.equal(withFormat(source,choice).engine,'av');
});

test('progressive-only mode returns a combined MP4 from Android and never returns HLS',async()=>{
 const calls=[];
 const p=new VideoProvider(async()=>({session:{},getBasicInfo:async(id,{client})=>{
  calls.push(client);
  if(client==='ANDROID')return {playability_status:{status:'OK'},basic_info:{title:'Bunny',duration:120},streaming_data:{formats:[
   {itag:18,has_video:true,has_audio:true,height:360,fps:30,bitrate:500000,mime_type:'video/mp4; codecs="avc1.42001E, mp4a.40.2"',decipher:async()=> 'https://video.googlevideo.com/18'}]}};
  return {playability_status:{status:'OK'},streaming_data:{hls_manifest_url:'https://manifest.googlevideo.com/master.m3u8'}};
 }}),undefined,{progressiveOnly:true});
 const source=await p.playback('aqz-KE-bpKQ');
 assert.equal(source.protocol,'mp4');assert.equal(source.engine,'html');assert.equal(source.height,360);
 assert.equal(source.selectedFormatId,'mp4-18');assert.equal(source.formats.length,1);
 assert.deepEqual(calls,['ANDROID']);
});

test('progressive-only mode reports a clear error when no combined MP4 exists',async()=>{
 const calls=[];
 const p=new VideoProvider(async()=>({session:{},getBasicInfo:async(id,{client})=>{
  calls.push(client);
  return {playability_status:{status:'OK'},streaming_data:{hls_manifest_url:'https://manifest.googlevideo.com/master.m3u8'}};
 }}),undefined,{progressiveOnly:true});
 await assert.rejects(p.playback('aqz-KE-bpKQ'),/combined MP4/);
 assert.deepEqual(calls,['ANDROID','ANDROID_VR','VISIONOS','IOS','TV']);
});

test('proxy mode uses VISIONOS HLS and rewrites variant URLs through the Worker',async()=>{
 const {proxyUrl}=await import('../src/config.mjs');
 const master='https://manifest.googlevideo.com/master.m3u8';
 const proxiedMaster=proxyUrl(master,'https://proxy.example');
 const proxiedVariant=proxyUrl('https://manifest.googlevideo.com/1080.m3u8','https://proxy.example');
 const requested=[];
 const request=async url=>{
  requested.push(String(url));
  return {ok:true,status:200,text:async()=>'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,FRAME-RATE=60,CODECS="avc1.64002a,mp4a.40.2"\n'+proxiedVariant+'\n'};
 };
 const p=new VideoProvider(async()=>({session:{},getBasicInfo:async(id,{client})=>{
  assert.equal(client,'VISIONOS');
  return {playability_status:{status:'OK'},basic_info:{title:'HD',duration:120},streaming_data:{hls_manifest_url:master}};
 }}),request,{progressiveOnly:false,proxyBase:'https://proxy.example'});
 const source=await p.playback('aqz-KE-bpKQ');
 assert.equal(requested[0],proxiedMaster);
 assert.equal(source.protocol,'hls');
 assert.equal(source.formats[0].url,proxiedMaster);
 assert.equal(source.formats[1].height,1080);
 assert.equal(source.formats[1].fps,60);
 assert.equal(source.formats[1].url,proxiedVariant);
});



test('TV home parser extracts tileRenderer videos from a signed-in response', async () => {
 const {tvHomeVideos} = await import('../src/provider.mjs');
 const data = JSON.parse("{\"contents\":{\"tvBrowseRenderer\":{\"content\":{\"tvSurfaceContentRenderer\":{\"content\":{\"sectionListRenderer\":{\"contents\":[{\"shelfRenderer\":{\"content\":{\"horizontalListRenderer\":{\"items\":[{\"tileRenderer\":{\"onSelectCommand\":{\"watchEndpoint\":{\"videoId\":\"aqz-KE-bpKQ\"}},\"metadata\":{\"tileMetadataRenderer\":{\"title\":{\"simpleText\":\"Bunny\"},\"lines\":[{\"lineRenderer\":{\"items\":[{\"lineItemRenderer\":{\"text\":{\"simpleText\":\"Blender\"}}}]}}]}},\"header\":{\"tileHeaderRenderer\":{\"title\":{\"simpleText\":\"Bunny\"},\"thumbnail\":{\"thumbnails\":[{\"url\":\"https://i.ytimg.com/vi/aqz-KE-bpKQ/hq.jpg\"}]},\"thumbnailOverlays\":[{\"thumbnailOverlayTimeStatusRenderer\":{\"text\":{\"simpleText\":\"10:34\"}}}]}}}},{\"tileRenderer\":{\"onSelectCommand\":{\"watchEndpoint\":{\"videoId\":\"bad\"}}}}]}}}}]}}}}}}}");
 const videos = tvHomeVideos(data);
 assert.equal(videos.length, 1);
 assert.deepEqual(videos[0], {id: 'aqz-KE-bpKQ', title: 'Bunny', author: {name: 'Blender'}, thumbnail: 'https://i.ytimg.com/vi/aqz-KE-bpKQ/hq.jpg', duration: '10:34'});
 const {normalizeVideos} = await import('../src/core.mjs');
 const normalized = normalizeVideos(videos);
 assert.equal(normalized[0].thumbnail, 'https://i.ytimg.com/vi/aqz-KE-bpKQ/hq.jpg');
 assert.equal(normalized[0].duration, '10:34');
});

test('TV home continuation prefers the section list token over shelf tokens', async () => {
 const {tvHomeContinuation} = await import('../src/provider.mjs');
 const data = {contents:{tvBrowseRenderer:{content:{tvSurfaceContentRenderer:{content:{sectionListRenderer:{
  contents:[{shelfRenderer:{content:{horizontalListRenderer:{continuations:[{nextContinuationData:{continuation:'SHELF'}}]}}}}],
  continuations:[{nextContinuationData:{continuation:'SECTION'}}]
 }}}}}}};
 assert.equal(tvHomeContinuation(data), 'SECTION');
});

test('TV home parser reads tiles from continuation response shapes and deduplicates', async () => {
 const {tvHomeVideos} = await import('../src/provider.mjs');
 const tile = id => ({tileRenderer:{onSelectCommand:{watchEndpoint:{videoId:id}},metadata:{tileMetadataRenderer:{title:{simpleText:id}}}}});
 const data = {
  continuationContents:{sectionListContinuation:{contents:[
   {shelfRenderer:{content:{horizontalListRenderer:{items:[tile('aqz-KE-bpKQ'),tile('aqz-KE-bpKQ')]}}}},
   {shelfRenderer:{content:{horizontalListRenderer:{items:[tile('second00001')]}}}}
  ]}},
  onResponseReceivedActions:[{appendContinuationItemsAction:{continuationItems:[tile('third000001')]}}]
 };
 const videos = tvHomeVideos(data);
 assert.deepEqual(videos.map(video => video.id), ['aqz-KE-bpKQ','second00001','third000001']);
});

test('homePage exposes and follows the anonymous continuation', async () => {
 const second = {videos:[{id:'second00001',title:'Second'}],has_continuation:false};
 const feed = {
  videos:[{id:'aqz-KE-bpKQ',title:'Bunny'}],
  has_continuation:true,
  getContinuation:async()=>second
 };
 const p = new VideoProvider(async()=>({getHomeFeed:async()=>feed}));
 const page = await p.homePage();
 assert.equal(page.videos.length, 1);
 assert.equal(page.continuation, 'anonymous');
 const more = await p.homeMore(page.continuation);
 assert.equal(more.videos[0].title, 'Second');
 assert.equal(more.continuation, '');
});
