import test from 'node:test';
import assert from 'node:assert/strict';
import {isAllowed,proxyUrl,rewriteManifest} from '../proxy/worker.js';
import {parseHlsFormats} from '../src/formats.mjs';

test('proxy only allows YouTube media/API hosts', () => {
  assert.equal(isAllowed(new URL('https://rr1---sn-uxaxpu5ap5-o52e.googlevideo.com/videoplayback?x=1')),true);
  assert.equal(isAllowed(new URL('https://manifest.googlevideo.com/api/manifest/hls_variant/x/index.m3u8')),true);
  assert.equal(isAllowed(new URL('https://www.youtube.com/youtubei/v1/search')),true);
  assert.equal(isAllowed(new URL('https://evil.example/video.mp4')),false);
  assert.equal(isAllowed(new URL('https://googlevideo.com.evil.example/video.mp4')),false);
});

test('manifest rewriter proxies absolute, attribute and relative URIs', () => {
  const base='https://manifest.googlevideo.com/api/manifest/hls_variant/master/index.m3u8';
  const input=[
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="https://manifest.googlevideo.com/api/audio.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,FRAME-RATE=60',
    'https://manifest.googlevideo.com/api/variant.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,FRAME-RATE=60',
    'relative-variant.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360',
    'https://evil.example/bad.m3u8'
  ].join('\n');
  const output=rewriteManifest(input,'https://proxy.example',base);
  assert.ok(output.includes('URI="'+proxyUrl('https://proxy.example','https://manifest.googlevideo.com/api/audio.m3u8')+'"'));
  assert.match(output,/https:\/\/proxy\.example\/\?url=https%3A%2F%2Fmanifest\.googlevideo\.com%2Fapi%2Fvariant\.m3u8/);
  assert.match(output,/https:\/\/proxy\.example\/\?url=https%3A%2F%2Fmanifest\.googlevideo\.com%2Fapi%2Fmanifest%2Fhls_variant%2Fmaster%2Frelative-variant\.m3u8/);
  assert.match(output,/https:\/\/evil\.example\/bad\.m3u8/);
});

test('HLS parser accepts proxied URLs when the proxy is configured', () => {
  const master='https://manifest.googlevideo.com/master.m3u8';
  const proxied=proxyUrl(master,'https://proxy.example');
  const variant=proxyUrl('https://manifest.googlevideo.com/1080.m3u8','https://proxy.example');
  const formats=parseHlsFormats(
    '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,FRAME-RATE=60,CODECS="avc1.64002a,mp4a.40.2"\n'+variant+'\n',
    proxied,
    value=>value.startsWith('https://proxy.example/')
  );
  assert.equal(formats[0].id,'auto');
  assert.equal(formats[1].height,1080);
  assert.equal(formats[1].fps,60);
  assert.equal(formats[1].url,variant);
});
