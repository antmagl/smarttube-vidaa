import test from 'node:test';
import assert from 'node:assert/strict';
import {trackingUrl, createTracker} from '../src/tracking.mjs';

test('tracking URL keeps player parameters and adds watchtime fields', () => {
  const base = 'https://s.youtube.com/api/stats/watchtime?ns=yt&docid=aqz-KE-bpKQ&ei=abc&vm=xyz&of=of1&len=120';
  const url = new URL(trackingUrl(base, {cpn: 'nonce', st: 10, et: 20.5, cmt: 20.5, final: 0}));
  assert.equal(url.searchParams.get('docid'), 'aqz-KE-bpKQ');
  assert.equal(url.searchParams.get('ei'), 'abc');
  assert.equal(url.searchParams.get('vm'), 'xyz');
  assert.equal(url.searchParams.get('of'), 'of1');
  assert.equal(url.searchParams.get('len'), '120');
  assert.equal(url.searchParams.get('cpn'), 'nonce');
  assert.equal(url.searchParams.get('st'), '10');
  assert.equal(url.searchParams.get('et'), '20.5');
  assert.equal(url.searchParams.get('final'), '0');
});

test('tracker ignores a response without watchtime tracking data', () => {
  assert.equal(createTracker(null, 'aqz-KE-bpKQ', 120), null);
  assert.equal(createTracker({}, 'aqz-KE-bpKQ', 120), null);
});
