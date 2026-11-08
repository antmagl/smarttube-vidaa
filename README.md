# SmartTube for VIDAA — 0.1

An unofficial, remote-first YouTube web client for Hisense VIDAA TVs, installed
as a normal launcher tile through
[Sidee](https://github.com/Empi9245/Sidee). This repository contains the app
source, the reference proxy and the Sidee preset.

This is **not the Android SmartTube app**. VIDAA has no Android runtime; the
app runs in the TV's Chromium-based web browser (`odin`).

> **Self-host only.** This repository does not host a ready-to-use app and does
> not provide a shared proxy. Deploy your own proxy, build the app with its URL
> and host the result yourself. Without your own proxy the app is limited to
> **360p/240p** and cannot sign in or record watch history.

## What you need

- A Hisense VIDAA TV (2024+ firmware recommended), on your home network.
- A Windows, macOS or Linux computer on the same network, to run Sidee.
- A phone or computer with a browser, to enter the Google sign-in code.
- Node.js 22 or newer for the build.
- A Cloudflare account (free) for the recommended Worker, or another HTTPS
  host that implements the proxy contract.

## From zero to signed in

### 1. Deploy your own proxy (Cloudflare Worker recommended)

1. Open <https://dash.cloudflare.com/> → **Workers & Pages** → **Create** →
   **Worker**.
2. Name it (for example `smarttube-vidaa-proxy`), create it, then choose
   **Edit code**.
3. Replace the sample code with [`vidaa/proxy/worker.js`](vidaa/proxy/worker.js)
   and choose **Deploy**.
4. Copy your Worker URL:
   `https://<name>.<your-subdomain>.workers.dev`

Cloudflare is not required. Any HTTPS host that implements the
[proxy contract](#proxy-host-required-for-1080p-and-sign-in) works.

### 2. Build the app with your proxy URL

```bash
# from the repository root
cd vidaa
npm install
npm test
SMARTTUBE_PROXY=https://<name>.<your-subdomain>.workers.dev \
  SMARTTUBE_BUILD=0.1 npm run build
```

### 3. Host `dist/` yourself

Upload `vidaa/dist/` to any HTTPS static host you control: GitHub Pages,
Netlify, Vercel, nginx, or your own server. The entry point is `index.html`.

### 4. Install the SmartTube tile

Start the Sidee fork from source:

```bash
git clone https://github.com/antmagl/Sidee
cd Sidee
python3 -m pip install -r requirements.txt
python3 sidee.py
```

On Windows use `python` instead of `python3`. Pair the TV (Find TV → Request
code → enter the 4-digit PIN → Confirm), then install with your hosted URL:

```bash
python3 sidee.py install smarttube --url https://your-host.example.com/
```

If your Sidee build does not support `--url`, edit the `url` field in
[`vidaa/sidee/smarttube_preset.py`](vidaa/sidee/smarttube_preset.py) before
installing.

### 5. Sign in to Google

1. On the TV, open **Settings** → **YouTube account** (it says `Signed out`)
   and press **OK**.
2. The TV displays a short code and asks you to open `google.com/device`.
3. On your phone or computer, open
   [google.com/device](https://www.google.com/device), enter the code, choose
   the Google account and approve access.
4. The TV changes to `Signed in` within a few seconds. Home reloads with your
   recommendations.

> Pressing **OK** on **YouTube account** while signed in signs you out.

### 6. Check playback and history

1. Pick a video and let it play for at least 30 seconds.
2. The TV's **History** tab lists it locally.
3. On [youtube.com](https://www.youtube.com/) → **History**, the video should
   appear within a minute.

### If something does not work

- **Only 360p.** The build was made without `SMARTTUBE_PROXY`, or your proxy is
  down/over quota. Rebuild with the proxy URL.
- **The tile opens an old build.** The TV caches launcher entries. Remove the
  old tile and install the new one.
- **"Account service is not configured".** The build has no proxy. Rebuild with
  your proxy URL.
- **The sign-in code expires.** Reopen **Settings → YouTube account** for a new
  code.
- **"Playback unavailable" or "Sign in to confirm you're not a bot".** YouTube
  challenged the request or your proxy is unavailable. Retry later; if it
  persists, check the proxy.
- **Find TV fails.** Make sure both devices are on the same network, disable
  VPN/guest Wi-Fi, allow port 36669, or enter the TV's IP manually.

## What works in 0.1

- Google sign-in with the TV one-time-code flow; the refresh token is stored
  only in the TV browser's `localStorage`.
- Signed-in home recommendations and YouTube watch history.
- Watchtime reporting, including the playback record that creates a history
  entry.
- 1080p/60fps HLS playback — requires your own proxy; without it the app is
  limited to 360p/240p.
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

## Repository layout

| Path | Contents |
| --- | --- |
| `vidaa/` | App source, build scripts, tests and assets |
| `vidaa/proxy/` | Reference CORS/media proxy for Cloudflare Workers |
| `vidaa/sidee/` | Sidee preset and integration notes |

## Proxy host (required for 1080p and sign-in)

`googlevideo.com` does not grant CORS to third-party origins, so the app cannot
read HLS/DASH segments or the higher-quality streams without a small HTTPS
relay. A proxy is **required** for the full app; without one you get 360p/240p
only and cannot sign in or record history.

**Cloudflare Workers is the recommended host.** The reference implementation in
[`vidaa/proxy/`](vidaa/proxy) runs there. Any compatible HTTPS host also works:
a VPS, Raspberry Pi, Docker container, Deno Deploy, Vercel/Netlify functions,
or nginx/Caddy.

The client only needs a base URL. It appends `/?url=<encoded target>` and calls
the auth/stats routes itself:

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

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Worker**.
2. Name it and paste [`vidaa/proxy/worker.js`](vidaa/proxy/worker.js).
3. Deploy and copy your `workers.dev` URL.
4. Build the app with `SMARTTUBE_PROXY` set to that URL.

Cloudflare's free Workers plan has daily request limits. 1080p HLS uses many
segment requests, so heavy viewing may hit them. Any other host has its own
bandwidth/request limits.

## Limitations

- Experimental; not Android SmartTube feature parity. Subscriptions UI,
  casting, voice search, live chat, comments, DeArrow, picture-in-picture and
  the Android player are not implemented.
- YouTube can change its TV endpoints or challenge an IP at any time. The app
  shows a readable error instead of bypassing a challenge.
- **Without a proxy the app is limited to 360p/240p**, with no sign-in and no
  watch history.
- HD playback depends on your proxy. If it is down or over quota, HD playback
  fails.
- DRM-protected and live formats are not guaranteed.
- SponsorBlock is a best-effort public API; segments can be missing or late.

## Privacy

- No Sidee credentials or TV pairing tokens are included.
- The Google refresh token stays in the TV browser and is only sent to your
  proxy for token refresh.
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
  web port (0.3.18, commit `7f8a22a`) that this VIDAA port is based on.
- **[YouTube.js](https://github.com/LuanRT/YouTube.js)** by
  [LuanRT](https://github.com/LuanRT) — the YouTube InnerTube client. MIT.
- **[hls.js](https://github.com/video-dev/hls.js)** — HLS playback.
  Apache-2.0.
- **[dash.js](https://github.com/Dash-Industry-Forum/dash.js)** — DASH
  playback. BSD-3-Clause.
- **[core-js](https://github.com/zloirock/core-js)** by
  [Denis Pushkarev](https://github.com/zloirock) — polyfills. MIT.
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
