import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeKey,isBack} from '../src/platform.mjs';
import {contentRegion} from '../src/session.mjs';

test('VIDAA remote directions and OK are normalized', () => {
  assert.equal(normalizeKey({key:'ArrowUp'}),'up');
  assert.equal(normalizeKey({key:'ArrowDown'}),'down');
  assert.equal(normalizeKey({key:'ArrowLeft'}),'left');
  assert.equal(normalizeKey({key:'ArrowRight'}),'right');
  assert.equal(normalizeKey({key:'Enter'}),'select');
  assert.equal(normalizeKey({key:'Unidentified',keyCode:38}),'up');
  assert.equal(normalizeKey({key:'Unidentified',keyCode:13}),'select');
});

test('Tizen/webOS/VIDAA back key codes and standard back keys work', () => {
  for (const event of [{key:'Escape'},{key:'Backspace'},{key:'BrowserBack'},{key:'Unidentified',keyCode:10009},{key:'Unidentified',keyCode:461},{key:'Unidentified',keyCode:8}]) {
    assert.equal(normalizeKey(event),'back');
    assert.equal(isBack(event),true);
  }
});

test('media transport keys map to play, pause, play-pause and stop', () => {
  assert.equal(normalizeKey({key:'MediaPlayPause'}),'playpause');
  assert.equal(normalizeKey({key:'Unidentified',keyCode:179}),'playpause');
  assert.equal(normalizeKey({key:'MediaPlay'}),'play');
  assert.equal(normalizeKey({key:'Unidentified',keyCode:415}),'play');
  assert.equal(normalizeKey({key:'MediaPause'}),'pause');
  assert.equal(normalizeKey({key:'Unidentified',keyCode:19}),'pause');
  assert.equal(normalizeKey({key:'MediaStop'}),'stop');
  assert.equal(normalizeKey({key:'Unidentified',keyCode:413}),'stop');
});

test('numbers and unknown keys do not steal normal input', () => {
  assert.equal(normalizeKey({key:'1'}),'number:1');
  assert.equal(normalizeKey({key:'9'}),'number:9');
  assert.equal(normalizeKey({key:'a'}),null);
  assert.equal(normalizeKey({key:'Unidentified',keyCode:70}),null);
});

test('content region follows a BCP-47 browser locale and falls back safely', () => {
  assert.equal(contentRegion('en-US'),'US');
  assert.equal(contentRegion('it-IT'),'IT');
  assert.equal(contentRegion('pt_BR'),'BR');
  assert.equal(contentRegion('en'),'US');
});
