# SmartTube for VIDAA — 0.1

An unofficial, remote-first YouTube web client for Hisense VIDAA TVs,
installable as a normal launcher tile through
[Sidee](https://github.com/Empi9245/Sidee). This repository contains the built
static web app.

This is **not the Android SmartTube app**. VIDAA has no Android runtime; the
app runs in the TV's Chromium-based web browser (`odin`).

**Current release: 0.1** — published as build `v16`. This is the first release
intended as a usable starting point.

## Open the app

- Version 0.1 (v16):
  **https://antmagl.github.io/smarttube-vidaa/v16/index.html**
- Latest build:
  **https://antmagl.github.io/smarttube-vidaa/**
- No server is required. History, settings and the account token stay in the
  TV browser.

## Install with Sidee

1. Start Sidee (`python sidee.py` from the Sidee checkout) and pair the TV.
2. Choose **SmartTube** and install. The hosted address is the default.
3. Press Home on the TV and open the SmartTube tile.

CLI equivalent:

```bash
python sidee.py install smarttube
```

Advanced users can self-host the files and override the address:

```bash
python sidee.py install smarttube --url http://192.168.1.20:8090/
```

The TV caches launcher tiles by app id. Each release is registered under a new
app id (build v16 uses `smarttube16`). If an old tile keeps opening an old
build, remove it and install the new one.

## What works in 0.1

- Google sign-in with the TV one-time-code flow; the refresh token is stored
  only in the TV browser's `localStorage`.
- Signed-in home recommendations and YouTube watch history.
- Watchtime reporting, including the playback record that creates a history
  entry.
- 1080p/60fps HLS playback through a Cloudflare Worker proxy.
- VP9 preferred when the TV reports support, with H.264 fallback.
- Original audio is selected automatically when YouTube offers AI-dubbed
  tracks.
- Endless home feed: more cards load as you approach the end, and Down on the
  last row fetches the next page.
- Home refreshes in the background every 5 minutes while you are on another
  page or watching a video.
- Home, Search, Music, Gaming, History and Settings views with D-pad focus.
- SponsorBlock auto-skip with category presets.
- Quality selection when more than one format is available.
- VIDAA remote keys: arrows, OK/Enter, Back/Escape, Play/Pause and Stop.

Without the Worker, the app falls back to the combined MP4 stream that YouTube
still exposes to its Android client (typically 360p, sometimes 240p).

## Versions

The root always serves the latest build. Every release also keeps an immutable
versioned snapshot for rollback:

| Path | Notes |
| --- | --- |
| `/` | Latest published build |
| `/v16/` | **0.1** — endless home, background refresh, history working |
| `/v15/` | TV client CORS fix |
| `/v14/` | History record attached to the first watchtime update |
| `/v13/` and older | Earlier test builds |

## Cloudflare Worker

HD playback needs the Cloudflare Worker from the `vidaa/` port (its source is
not part of this build repository) because `googlevideo.com` does not grant CORS
to third-party origins. The Worker also handles the TV sign-in exchange and
watch-history requests.

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Worker**.
2. Name it `smarttube-vidaa-proxy` and deploy the port's `proxy/worker.js`.
3. Copy the `https://smarttube-vidaa-proxy.<subdomain>.workers.dev` URL.
4. Build the app with `SMARTTUBE_PROXY` set to that URL.

The Worker only proxies YouTube/Google hosts, preserves `Range`/`206`
responses, rewrites HLS manifests, applies the TV User-Agent only to TVHTML5
player requests, and forwards watch-history reports.

Cloudflare's free Workers plan has daily request limits. 1080p HLS uses many
segment requests, so heavy viewing may hit them.

## Architecture

This repository is the static output of the `vidaa/` port. The running app
uses:

- a direct page (`index.html`) with a CSP, no sandboxed iframe;
- a Cloudflare Worker for CORS, media, TV sign-in and watch-history;
- the YouTube TVHTML5 client for signed playback, with TV7 and public profiles
  as fallbacks;
- HLS.js / dash.js through the Worker for 1080p adaptive streams;
- server-issued visitor data to avoid bot challenges;
- `localStorage` for the refresh token, settings and recent history.

The source is derived from the MIT TizenSmartTube 0.3.18 base and keeps the
SmartTube experience rather than the Android player.

## Limitations

- Experimental; not Android SmartTube feature parity. Subscriptions UI,
  casting, voice search, live chat, comments, DeArrow, picture-in-picture and
  the Android player are not implemented.
- YouTube can change its TV endpoints or challenge an IP at any time. The app
  shows a readable error instead of bypassing a challenge.
- HD playback depends on the Cloudflare Worker. If it is down or over quota,
  HD playback fails.
- DRM-protected and live formats are not guaranteed.
- SponsorBlock is a best-effort public API; segments can be missing or late.

## Privacy

- No Sidee credentials or TV pairing tokens are included.
- The Google refresh token stays in the TV browser and is only sent to the
  Cloudflare Worker for token refresh.
- Stream URLs are signed, expire, and are never written to history.
- No project-operated backend, telemetry or analytics.

## Attribution

MIT. See `LICENSE` and `THIRD_PARTY_NOTICES.md`. This is an independent
project and is not affiliated with or endorsed by SmartTube, YouTube, Google,
Hisense or VIDAA.
