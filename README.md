# SmartTube for VIDAA — 0.1

An unofficial, remote-first YouTube web client for Hisense VIDAA TVs,
installable as a normal launcher tile through
[Sidee](https://github.com/Empi9245/Sidee). This repository contains the built
static web app.

This is **not the Android SmartTube app**. VIDAA has no Android runtime; the
app runs in the TV's Chromium-based web browser (`odin`).

**Current release: 0.1** — published as build `v16`. This is the first release
intended as a usable starting point.

Direct URL:
**https://antmagl.github.io/smarttube-vidaa/v16/index.html**

## From zero to signed in (hosted build)

Recommended path. Nothing needs to be built and no Cloudflare account is
needed — the hosted build already points at a working proxy.

### What you need

- A Hisense VIDAA TV (2024+ firmware recommended), on your home network.
- A Windows, macOS or Linux computer on the same network, to run Sidee.
- A phone or computer with a browser, to enter the Google sign-in code.

### 1. Start Sidee and pair the TV

> **SmartTube is not in upstream Sidee's built-in catalog.** Use
> [antmagl/Sidee](https://github.com/antmagl/Sidee), a fork with Linux support
> and the SmartTube preset, or add the preset from
> [`vidaa/sidee/`](vidaa/sidee) to upstream Sidee.

1. Download Sidee from
   [antmagl/Sidee releases](https://github.com/antmagl/Sidee/releases), or run
   the fork from a source checkout. Keep it running while you use the
   dashboard.
2. Upstream Sidee only: add the entry from
   [`vidaa/sidee/smarttube_preset.py`](vidaa/sidee/smarttube_preset.py) to
   `PRESETS` in `core/presets.py`, then start Sidee with `python3 sidee.py`.
3. Turn on the TV and connect it to the same home network.
4. In the Sidee dashboard, click **Find TV**. If discovery fails, enter the
   TV's IP address from its network settings.
5. Click **Request code**, then enter the 4-digit PIN shown on the TV.
6. Confirm the code. Sidee is now paired.

### 2. Install the SmartTube tile

- If your Sidee dashboard lists SmartTube: choose **SmartTube** and install it.
- Otherwise use the CLI:

  ```bash
  python3 sidee.py install smarttube
  ```

The hosted address is the default; no URL is needed. Sidee sends the tile to
the TV. You can close Sidee afterwards; the tile keeps working.

### 3. Open it on the TV

1. Press **Home** on the remote.
2. Open the SmartTube tile. The first load may take a few seconds.
3. Open **Settings** in the left sidebar. The bottom line should read:

   `SmartTube for VIDAA 0.1.0 · v16 · unofficial`

   If it shows an older version, the TV is still using a cached tile: remove
   the old tile and install the new one.

### 4. Sign in to Google

1. On the TV, open **Settings** → **YouTube account** (it says `Signed out`)
   and press **OK**.
2. The TV displays a short code and asks you to open
   `google.com/device`.
3. On your phone or computer, open
   [google.com/device](https://www.google.com/device), enter the code, choose
   the Google account and approve access.
4. The TV changes to `Signed in` within a few seconds. Home reloads with your
   recommendations.

> Pressing **OK** on **YouTube account** while signed in signs you out.

### 5. Check playback and history

1. Pick a video and let it play for at least 30 seconds.
2. The TV's **History** tab lists it locally.
3. On [youtube.com](https://www.youtube.com/) → **History**, the video should
   appear within a minute.

### If something does not work

- **The tile opens an old build.** The TV caches launcher entries. Remove the
  old tile and install the new one.
- **"Account service is not configured".** That build has no proxy. Use the
  hosted URL above, or rebuild with a proxy (see below).
- **The sign-in code expires.** Reopen **Settings → YouTube account** for a new
  code.
- **"Playback unavailable" or "Sign in to confirm you're not a bot".** YouTube
  challenged the request or the proxy is unavailable. Retry later; if it
  persists, check the proxy.
- **Find TV fails.** Make sure both devices are on the same network, disable
  VPN/guest Wi-Fi, allow port 36669, or enter the TV's IP manually.
- **No HD.** The proxy is down or over quota; the 360p fallback still plays.

### Self-hosting instead

The full app source is included in [`vidaa/`](vidaa). With Node.js 22:

```bash
cd vidaa
npm install
npm test
SMARTTUBE_PROXY=https://your-proxy.example.com SMARTTUBE_BUILD=0.1 npm run build
```

See **HD proxy** below for the proxy requirements.

Publish `dist/` on any HTTPS static host, then install the tile with your URL:

```bash
python sidee.py install smarttube --url https://your-host.example.com/
```

You sign in to Google exactly as in step 4 above.

## What works in 0.1

- Google sign-in with the TV one-time-code flow; the refresh token is stored
  only in the TV browser's `localStorage`.
- Signed-in home recommendations and YouTube watch history.
- Watchtime reporting, including the playback record that creates a history
  entry.
- 1080p/60fps HLS playback through a CORS/media proxy (the included
  Cloudflare Worker is a reference implementation, not a requirement).
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

Without any proxy, the app still plays the combined MP4 stream that YouTube
exposes to its Android client (typically 360p, sometimes 240p). Sign-in, watch
history and HD playback are unavailable in that mode.

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
| `/vidaa/` | App source, Sidee preset and Worker source (not a runnable build) |

## HD proxy (optional)

`googlevideo.com` does not grant CORS to third-party origins, so HD playback
and sign-in need a small HTTPS relay. The included reference implementation
runs on Cloudflare Workers, but Cloudflare is **not required** — any host that
implements the same routes works: a VPS, Raspberry Pi, Docker container, Deno
Deploy, Vercel/Netlify functions, or nginx/Caddy.

The client only needs a base URL. It appends `/?url=<encoded target>` and calls
the auth/stats routes itself. Rebuild with any HTTPS base URL:

```bash
SMARTTUBE_PROXY=https://your-proxy.example.com npm run build
```

A compatible proxy must:

- forward only allowlisted YouTube/Google hosts (never act as an open proxy);
- add CORS headers, including `X-Goog-AuthUser`, and preserve `Range`/`206`;
- rewrite HLS manifests so variants, audio tracks and segments stay proxied;
- provide `/auth/device`, `/auth/token` and `/auth/refresh` for TV sign-in;
- provide `/stats` and handle the `ytrec` watchtime marker for history;
- be served over HTTPS (the app page is HTTPS and mixed content is blocked).

`/debug/log` is optional; the app ignores failures there.

### Cloudflare Worker reference

The easiest path is the Worker in [`vidaa/proxy/`](vidaa/proxy) in this repository:

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Worker**.
2. Name it `smarttube-vidaa-proxy` and deploy [`vidaa/proxy/worker.js`](vidaa/proxy/worker.js).
3. Copy the `https://smarttube-vidaa-proxy.<subdomain>.workers.dev` URL.
4. Build the app with `SMARTTUBE_PROXY` set to that URL.

The reference Worker applies the TV User-Agent only to TVHTML5 player requests
and forwards watch-history reports.

Cloudflare's free Workers plan has daily request limits. 1080p HLS uses many
segment requests, so heavy viewing may hit them. Any other host has its own
bandwidth/request limits.

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
- HD playback depends on the configured CORS/media proxy (the included
  Cloudflare Worker is the reference). If the proxy is down or over quota,
  HD playback fails.
- DRM-protected and live formats are not guaranteed.
- SponsorBlock is a best-effort public API; segments can be missing or late.

## Privacy

- No Sidee credentials or TV pairing tokens are included.
- The Google refresh token stays in the TV browser and is only sent to the
  Cloudflare Worker for token refresh.
- Stream URLs are signed, expire, and are never written to history.
- No project-operated backend, telemetry or analytics.

## Credits

This port would not exist without the work of these projects and people:

- **[SmartTube](https://github.com/yuliskov/SmartTube)** by
  [Yuriy Lyskov (yuliskov)](https://github.com/yuliskov) and contributors —
  the original Android TV app whose behaviour, SponsorBlock logic, TV OAuth
  client and remote-first UX this port follows. MIT.
- **[TizenSmartTube](https://github.com/giilc/TizenSmartTube)** by
  [giilc](https://github.com/giilc) and contributors — the MIT-licensed Tizen
  web port (0.3.18, commit `7f8a22a`) that this VIDAA port is based on. The
  playback provider, adaptive-format pairing, HLS/DASH players, SponsorBlock
  logic, remote navigation, tests and build structure are adapted from it.
- **[YouTube.js](https://github.com/LuanRT/YouTube.js)** by
  [LuanRT](https://github.com/LuanRT) — the YouTube InnerTube client used for
  browsing, search and playback metadata. MIT.
- **[hls.js](https://github.com/video-dev/hls.js)** — HLS playback.
  Apache-2.0.
- **[dash.js](https://github.com/Dash-Industry-Forum/dash.js)** — DASH
  playback. BSD-3-Clause.
- **[core-js](https://github.com/zloirock/core-js)** by
  [Denis Pushkarev](https://github.com/zloirock) — polyfills for older TV
  engines. MIT.
- **[Sidee](https://github.com/Empi9245/Sidee)** by
  [Empi9245](https://github.com/Empi9245) and contributors — TV pairing and
  launcher-tile installation.
- **[SponsorBlock](https://sponsor.ajay.app/)** — the public skip-segment API.
- **Roboto Condensed** — Google Fonts contributors, SIL Open Font License 1.1.
- **YouTube and Google** — the TV endpoints and OAuth service used
  unofficially by this client.
- **VIDAA port and web hosting** by [antmagl](https://github.com/antmagl).

The complete license texts are in `THIRD_PARTY_NOTICES.md`, `LICENSE` and
`licenses/`.

## Licence

MIT. This is an independent project and is not affiliated with or endorsed by
SmartTube, YouTube, Google, Hisense or VIDAA.
