import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession,bootstrapVisitor} from '../src/session.mjs';

test('bootstrap visitor comes from the public search API', async()=>{
  let request;
  const visitor=await bootstrapVisitor(async (url,options)=>{
    request={url:String(url),options};
    return {ok:true,json:async()=>({responseContext:{visitorData:'server-issued'}})};
  });
  assert.equal(visitor,'server-issued');
  assert.match(request.url,/\/youtubei\/v1\/search\?prettyPrint=false$/);
  assert.equal(request.options.method,'POST');
});

test('a failed bootstrap returns an empty visitor instead of rejecting', async()=>{
  assert.equal(await bootstrapVisitor(async()=>{throw Error('offline');}),'');
  assert.equal(await bootstrapVisitor(async()=>({ok:false,json:async()=>({})})),'');
});

test('session creation never calls the CORS-blocked /sw.js_data endpoint', async()=>{
  const previous=globalThis.fetch;
  const requests=[];
  globalThis.fetch=async input=>{
    requests.push(new URL(typeof input==='string'?input:input.url || input));
    throw Error('offline');
  };
  try {
    const client=await createSession();
    assert.ok(client);
    assert.equal(requests[0].pathname,'/youtubei/v1/search');
    assert.ok(requests.every(url=>url.pathname!=='/sw.js_data'),
      'the hosted app cannot read /sw.js_data without CORS');
  } finally {
    globalThis.fetch=previous;
  }
});
