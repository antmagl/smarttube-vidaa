import test from 'node:test';
import assert from 'node:assert/strict';
import {createTvPlaybackClient,parseTvPage,parsePlayerTimestamp} from '../src/tv-provider.mjs';

const video={playabilityStatus:{status:'OK'},videoDetails:{videoId:'TsRyPXO4Quw',title:'Test',lengthSeconds:'120'},streamingData:{adaptiveFormats:[{itag:299,url:'https://video.googlevideo.com/media?n=abc',mimeType:'video/mp4; codecs="avc1.64002a"',qualityLabel:'1080p60',height:1080,width:1920,fps:60,bitrate:2000000,initRange:{start:'0',end:'600'},indexRange:{start:'601',end:'1000'}}]}};
const tvPage='<html><script>ytcfg.set({"visitorData":"server-issued-visitor"});<\/script><script src="/s/player/tv123/tv-player-ias.vflset/tv-player-ias.js"><\/script></html>';

function setup(status='OK'){
 const requests=[],deciphers=[];let prepares=0,destroys=0;
 const solver={prepare:async()=>{prepares++;},decipher:async(...args)=>{deciphers.push(args);return 'https://video.googlevideo.com/decoded';},destroy:()=>destroys++};
 const request=async(url,opts)=>{
   requests.push({url:String(url),opts});
   if(String(url).includes('/youtubei/'))return Response.json(status==='OK'?video:{playabilityStatus:{status,reason:'Sign-in needed'}});
   if(String(url).endsWith('/tv'))return new Response(tvPage);
   if(String(url).includes('/s/player/'))return new Response('signatureTimestamp:20756;');
   return new Response('"VISITOR_DATA":"fallback-visitor"');
 };
 return {client:createTvPlaybackClient({request,solverFactory:()=>solver}),requests,deciphers,get prepares(){return prepares;},get destroys(){return destroys;}};
}

test('TV page parser reads visitor data and the TV player script',()=>{
 assert.deepEqual(parseTvPage(tvPage),{visitor:'server-issued-visitor',path:'/s/player/tv123/tv-player-ias.vflset/tv-player-ias.js'});
 assert.equal(parsePlayerTimestamp('signatureTimestamp:20756;'),20756);
 assert.equal(parsePlayerTimestamp('sts : 12345;'),12345);
 assert.deepEqual(parseTvPage('<html></html>'),{visitor:'',path:''});
});

test('TV metadata uses the matching TV script timestamp and server-issued visitor',async()=>{
 const s=setup(),info=await s.client.getBasicInfo('TsRyPXO4Quw');const req=s.requests.find(r=>r.url.includes('/youtubei/')),body=JSON.parse(req.opts.body);
 assert.equal(body.context.client.clientName,'TVHTML5');
 assert.equal(body.context.client.clientVersion,'5.20260707');
 assert.equal(body.context.client.visitorData,'server-issued-visitor');
 assert.equal(body.playbackContext.contentPlaybackContext.signatureTimestamp,20756);
 assert.equal(req.opts.headers['X-YouTube-Client-Version'],body.context.client.clientVersion);
 assert.equal(await info.streaming_data.adaptive_formats[0].decipher(),'https://video.googlevideo.com/decoded');
 assert.equal(s.deciphers[0][0],'https://video.googlevideo.com/media?n=abc');
 s.client.destroy();assert.equal(s.destroys,1);
});

test('the root page is used only when /tv has no TV configuration',async()=>{
 const requests=[];
 const request=async url=>{
   requests.push(String(url));
   if(String(url).endsWith('/tv'))return new Response('<html>consent</html>');
   if(String(url).endsWith('/'))return new Response('"VISITOR_DATA":"fallback-visitor"<script src="/s/player/x/x.js"></script>');
   if(String(url).includes('/s/player/'))return new Response('signatureTimestamp:20756;');
   return Response.json(video);
 };
 const client=createTvPlaybackClient({request,solverFactory:()=>({prepare:async()=>{},decipher:async()=> 'https://video.googlevideo.com/decoded',destroy:()=>{}})});
 await client.getBasicInfo('TsRyPXO4Quw');
 assert.equal(requests[0],'https://www.youtube.com/tv');
 assert.equal(requests[1],'https://www.youtube.com/');
 client.destroy();
});

test('concurrent videos share initialization; access challenges are preserved',async()=>{
 const s=setup('LOGIN_REQUIRED');const info=await s.client.getBasicInfo('TsRyPXO4Quw');assert.equal(info.playability_status.status,'LOGIN_REQUIRED');assert.equal(s.prepares,0);assert.equal(s.requests.filter(r=>r.url.includes('/youtubei/')).length,1);s.client.destroy();
 const c=setup();await Promise.all([c.client.getBasicInfo('TsRyPXO4Quw'),c.client.getBasicInfo('AyZNnxLGGlw')]);assert.equal(c.prepares,2);c.client.destroy();
});

test('missing visitor or timestamp fails before any player metadata request and cleans up',async()=>{
 let prepared=0;
 const s=createTvPlaybackClient({request:async()=>new Response('unusable page'),solverFactory:()=>({prepare:async()=>prepared++,destroy:()=>{}})});
 await assert.rejects(s.getBasicInfo('TsRyPXO4Quw'),/visitor/);assert.equal(prepared,0);s.destroy();
});
