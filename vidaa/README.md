# SmartTube for VIDAA — 0.1

An unofficial, remote-first YouTube web client for Hisense VIDAA TVs, built
from the SmartTube experience and installed as a normal launcher tile through
[Sidee](https://github.com/Empi9245/Sidee).

This is **not the Android SmartTube app** and it is not an APK. VIDAA has no
Android runtime; it runs a Chromium-based web-app browser (`odin`). This port
keeps the parts of SmartTube that a web app can provide — a TV layout, direct
stream selection, SponsorBlock, signed-in recommendations, watch history and no
advertising UI — and runs entirely in the TV browser.

**Version 0.1** is the first release intended as a usable starting point.
It corresponds to the hosted build published under `/v16/`.

> **Proxy required for HD and account features.**
> Without a configured proxy the app falls back to YouTube's combined MP4
> stream — usually **360p, sometimes 240p**. Sign-in, watch history and
> 1080p/60fps are unavailable in that mode.
>
> The hosted build already includes the project's Worker. Self-hosted builds
> must deploy a proxy (Cloudflare recommended) and build with
> `SMARTTUBE_PROXY=<url>`.

## From zero to signed in

### What you need

- A Hisense VIDAA TV (2024+ firmware recommended), on your home network.
- A Windows, macOS or Linux computer on the same network, to run Sidee.
- A phone or computer with a browser, to enter the Google sign-in code.

### Option A — hosted build (recommended)

Nothing needs to be built and no Cloudflare account is needed; the hosted
build already points at a working proxy.

> **SmartTube is not in upstream Sidee's built-in catalog.** Use
> [antmagl/Sidee](https://github.com/antmagl/Sidee), a fork that includes Linux
> support and this preset, or add the preset from
> [`sidee/README.md`](sidee/README.md) to upstream Sidee.

1. Clone and start the fork from source:

   ```bash
   git clone https://github.com/antmagl/Sidee
   cd Sidee
   python3 -m pip install -r requirements.txt
   python3 sidee.py
   ```

   On Windows use `python` instead of `python3`. The fork is installed from
   source; it does not publish release packages. Keep the terminal open.
   With upstream Sidee, add the entry from
   [`sidee/smarttube_preset.py`](sidee/smarttube_preset.py) to `PRESETS` in
   `core/presets.py` before starting it.
2. Turn on the TV and connect it to the same home network.
3. In the Sidee dashboard, click **Find TV** (or enter the TV's IP address).
4. Click **Request code**, enter the 4-digit PIN shown on the TV, and confirm.
5. Install the tile:
   - If your Sidee dashboard lists SmartTube: choose **SmartTube** and install.
   - Otherwise use the CLI: `python3 sidee.py install smarttube`.
   The hosted address is the default:
   <https://antmagl.github.io/smarttube-vidaa/v16/index.html>.
6. Press **Home** on the TV and open the SmartTube tile.
7. Open **Settings** in the left sidebar. The bottom line should read
   `SmartTube for VIDAA 0.1.0 · v16 · unofficial`.

### Option B — build and self-host

1. **Deploy a proxy first.** It is required for 1080p, sign-in and watch
   history. Cloudflare Worker recommended; see
   [Proxy host](#proxy-host-required-for-1080p-and-sign-in). Without it, the
   app only plays 360p/240p.
2. Install Node.js 22 or newer and build with the proxy URL:

   ```bash
   cd vidaa
   npm install
   npm test
   SMARTTUBE_PROXY=https://your-proxy.example.com SMARTTUBE_BUILD=0.1 npm run build
   ```

3. Publish `dist/` on any HTTPS static host, or test on the LAN with
   `npm run serve`.
4. Install the tile with your URL:

   ```bash
   python sidee.py install smarttube --url https://your-host.example.com/
   ```

Skipping step 1 gives you **360p/240p only** and no account features.

### Sign in to Google (both options)

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

The refresh token is stored only in the TV browser's `localStorage`. It is
sent to the configured proxy only for token refresh; the proxy does not keep
it.

### Check playback and history

1. Pick a video and let it play for at least 30 seconds.
2. The TV's **History** tab lists it locally.
3. On [youtube.com](https://www.youtube.com/) → **History**, the video should
   appear within a minute.

### Troubleshooting

- **The tile opens an old build.** The TV caches launcher entries by app id.
  Each release uses a new id; remove the old tile and install the new one.
- **"Account service is not configured".** The build has no proxy. Use the
  hosted build or rebuild with `SMARTTUBE_PROXY`.
- **The sign-in code expires.** Reopen **Settings → YouTube account** for a new
  code.
- **"Playback unavailable" or "Sign in to confirm you're not a bot".** YouTube
  challenged the request or the proxy is unavailable. Retry later; if it
  persists, check the proxy.
- **Find TV fails.** Make sure both devices are on the same network, disable
  VPN/guest Wi-Fi, allow port 36669, or enter the TV's IP manually.
- **No HD.** The proxy is down or over quota; the 360p fallback still plays.

## What works

- Google sign-in with the TV one-time-code flow. The account token is stored
  only in the TV browser's `localStorage`.
- Signed-in home recommendations and YouTube watch history.
- Watchtime reporting, including the playback record that creates a history
  entry.
- 1080p/60fps HLS playback — requires the configured proxy; without it the app
  is limited to 360p/240p.
- VP9 is preferred when the TV reports support, with H.264 fallback.
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
- Sidee integration: the hosted build is a static site and needs no computer
  or local server.

> **No proxy = 360p only.** Without a configured proxy the app falls back to the
> combined MP4 stream (usually 360p, sometimes 240p). Sign-in, watch history and
> 1080p/60fps are unavailable.

## Build

Node.js 22 or newer is required.

> **A plain `npm run build` is the 360p-only fallback.** For 1080p, sign-in and
> watch history, set `SMARTTUBE_PROXY` to a deployed proxy. See
> [Proxy host](#proxy-host-required-for-1080p-and-sign-in).

```bash
cd vidaa
npm install
npm test
SMARTTUBE_PROXY=https://your-proxy.example.com SMARTTUBE_BUILD=0.1 npm run build
```

For the 360p-only fallback (no proxy, no sign-in, no history):

```bash
npm run build
```

`npm run build` writes a self-contained app to `vidaa/dist/`:

| File | Purpose |
| --- | --- |
| `index.html` | Direct app page and CSP |
| `app.js` | Bundled application |
| `style.css`, `icon.png` | TV UI |
| `tv-decipher-worker.js` | Isolated YouTube player-script solver |
| `fonts/`, `licenses/`, `LICENSE`, `THIRD_PARTY_NOTICES.md` | Runtime assets and notices |
| `build.json` | Version, build label and dependency pins |

To include the Cloudflare Worker URL and a visible build label:

```bash
SMARTTUBE_PROXY=https://smarttube-vidaa-proxy.<subdomain>.workers.dev \
SMARTTUBE_BUILD=v16 npm run build
```

### Run locally for development

The included static server binds to the LAN and sends the no-cache headers the
VIDAA browser needs:

```bash
npm run serve
# or:
python3 scripts/serve.py dist 8090
```

Use the printed `192.168.x.x` / `10.x.x.x` address from the TV; `127.0.0.1`
points at the TV itself.

## Proxy host (required for 1080p and sign-in)

`googlevideo.com` does not grant CORS to third-party origins, so the app cannot
read HLS/DASH segments or the higher-quality streams without a small HTTPS
relay. A proxy is **required** for the full app; without one you get 360p/240p
only and cannot sign in or record history.

**Cloudflare Workers is the recommended host.** The reference implementation in
[`proxy/`](proxy) runs there. Any compatible HTTPS host also works: a VPS,
Raspberry Pi, Docker container, Deno Deploy, Vercel/Netlify functions, or
nginx/Caddy.

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

The easiest path is [`proxy/worker.js`](proxy/worker.js):

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Worker**.
2. Name it `smarttube-vidaa-proxy` and paste `proxy/worker.js`.
3. Deploy and copy the `https://smarttube-vidaa-proxy.<subdomain>.workers.dev`
   URL.
4. Rebuild the app with `SMARTTUBE_PROXY` set to that URL.

The reference Worker:

- only proxies YouTube and Google media hosts;
- adds CORS headers, including `X-Goog-AuthUser` needed by the TV client;
- preserves `Range`/`206` responses;
- rewrites HLS manifests so every variant, audio track and segment goes
  through the proxy;
- applies the TV User-Agent only to `TVHTML5` player requests;
- handles the TV OAuth device-code flow in `/auth/*`;
- sends the playback record for watch history on `/stats` and when a
  watchtime request carries the `ytrec` marker.

Cloudflare's free Workers plan has daily request limits. 1080p HLS uses many
segment requests, so heavy viewing may hit them. A paid Workers plan or a
small VPS/Raspberry Pi proxy avoids that limit. Any other host has its own
bandwidth and request limits.

## Architecture

| File | Responsibility |
| --- | --- |
| `src/app.mjs` | UI, remote events, home pagination, playback coordination |
| `src/platform.mjs` | VIDAA key mapping, vendor device info and exit fallback |
| `src/provider.mjs` | YouTube/SponsorBlock requests, TV home pagination, timeouts |
| `src/session.mjs` | Visitor bootstrap, signed TV playback routing |
| `src/tv-provider.mjs` | TV page parsing, player request, URL deciphering |
| `src/tv-solver.mjs` | Isolated EJS player-script worker |
| `src/auth.mjs` | TV device-code sign-in, token refresh, local storage |
| `src/tracking.mjs` | Playback/watchtime reporting and history records |
| `src/adaptive.mjs` | Adaptive video/audio track pairing and DASH manifests |
| `src/dash-player.mjs` | dash.js/MediaSource playback and quality switching |
| `src/hls-player.mjs` | HLS.js/MediaSource playback, original audio selection |
| `src/formats.mjs` | Manifest parsing and codec/variant preservation |
| `src/core.mjs` | Video normalization and SponsorBlock skip decisions |
| `src/ui-state.mjs` | Focus movement, history and preferences |
| `src/polyfills.mjs` | Compatibility with older Chromium engines |

How it works:

1. `index.html` loads the app directly (no sandboxed iframe). Requests to
   YouTube go through the Worker, which supplies the CORS headers the TV
   browser needs.
2. A small public search bootstraps a server-issued visitor ID, avoiding the
   bot checks a purely random local session triggers.
3. Signed playback uses the TVHTML5 client and the TV OAuth token. It falls
   back to TV7 and then the public VISIONOS/iOS/Android profiles.
4. HLS and adaptive DASH media run through the Worker so the TV can read them.
5. Watch history is reported through `/api/stats/playback` and
   `/api/stats/watchtime`; the Worker sends the playback record because the
   VIDAA browser can drop that request during startup.

## Versioning and TV caching

The hosted repository keeps the root plus immutable snapshots for every
release (`/v2/` … `/v16/`). The root always serves the latest build.

The TV caches launcher tiles by app id, so each release is registered under a
new Sidee app id (`smarttube16` for build v16). If a tile keeps opening an old
build after an update, remove the old tile and install the new one.

## Limitations

- **Not Android SmartTube.** Subscriptions UI, casting, voice search, live
  chat, comments, DeArrow, picture-in-picture and the Android player are not
  implemented.
- YouTube can change its TV endpoints, require sign-in or challenge an IP at
  any time. The app shows a readable error instead of bypassing a challenge.
- **Without a proxy the app is limited to 360p/240p**, with no sign-in and no
  watch history.
- **1080p/60fps depends on the configured proxy** (the included Cloudflare
  Worker is the reference). If the proxy is down or over quota, HD playback
  fails.
- DRM-protected and live formats are not guaranteed.
- SponsorBlock is a best-effort public API; segments can be missing or late.
- The app is experimental. Test on the exact TV firmware before publishing a
  build.

## Security and privacy

- No Sidee credentials or TV pairing tokens are included in the app.
- The Google refresh token stays in the TV browser's `localStorage` and is
  only sent to the Cloudflare Worker for token refresh.
- Stream URLs are signed and expire. They are held in memory and are never
  written to history.
- There is no project-operated backend, telemetry or analytics.
- The CSP permits `'unsafe-eval'` only because YouTube.js and the bundled EJS
  solver compile the player script. The solver runs in a worker with an
  isolated scope.

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

The complete license texts are in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md),
[`LICENSE`](LICENSE) and [`licenses/`](licenses).

## Development notes

- `npm test` runs 91 tests for provider parsing, home pagination, the TV page
  parser, adaptive pairing, HLS/DASH lifecycle, remote key mapping,
  SponsorBlock, tracking and UI state.
- Build target is Chromium 77 syntax; the reference runtime is VIDAA `odin`
  Chromium 111.
- See [Credits](#credits) and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)
  for the projects this port is built on.
- SmartTube, YouTube.js, dash.js, HLS.js, core-js and the Roboto Condensed
  font retain their own licenses in `licenses/` and `fonts/`.

## Licence

MIT. This is an independent project and is not affiliated with or endorsed by
SmartTube, YouTube, Google, Hisense or VIDAA.
