# SmartTube VIDAA proxy

Optional HTTPS relay for the SmartTube VIDAA web client. This directory
contains a reference implementation for **Cloudflare Workers**. Cloudflare is
not required: any HTTPS host that implements the [proxy contract](#proxy-contract)
works, including a VPS, Raspberry Pi, Docker container, Deno Deploy,
Vercel/Netlify functions or nginx/Caddy.

The player works without a proxy, but only for the combined 360p/240p MP4
stream that YouTube exposes to its Android client. A proxy is required for:

- 1080p/60fps HLS/DASH playback;
- Google sign-in (TV device-code exchange);
- YouTube watch history and watchtime reporting.

## What it does

- proxies only allowlisted YouTube/Google hosts — it is not an open proxy;
- adds CORS headers, forwards `Authorization` and `Range`, and preserves
  `206 Partial Content`;
- rewrites HLS manifests so variants, audio tracks and segments stay proxied;
- provides the TV OAuth device-code endpoints;
- sends the playback record that creates a watch-history entry;
- applies the TV User-Agent only to `TVHTML5` player requests.

It keeps no storage and no credentials. The OAuth client ID/secret in
`worker.js` is SmartTube's public TV client, not a personal secret. Your
Cloudflare account and Worker URL are your own; nothing here points at the
maintainer's deployment.

## Deploy from the Cloudflare dashboard (no Node needed)

1. Open <https://dash.cloudflare.com/> → **Workers & Pages** → **Create** →
   **Worker**.
2. Name it (for example `smarttube-vidaa-proxy`), create it, then choose
   **Edit code**.
3. Replace the sample code with the contents of [`worker.js`](worker.js).
4. Choose **Deploy**.
5. Copy the public URL shown for your Worker:
   `https://<name>.<your-subdomain>.workers.dev`
6. Build the app with that URL:

   ```bash
   SMARTTUBE_PROXY=https://<name>.<your-subdomain>.workers.dev npm run build
   ```

> **This must be a Worker, not a Pages static site.** If `worker.js` is
> uploaded as a file in a Pages project, Cloudflare serves it as source at
> `/worker.js` and does not execute it. `/?url=...` then returns 404. Create it
> under the **Workers** tab, not the **Pages** tab.

## Deploy with Wrangler

Requires Node.js 18+ and a Cloudflare login:

```bash
cd vidaa/proxy
npx wrangler login
npx wrangler deploy
```

`wrangler.toml` contains only a generic name and the entry point. Wrangler
prints your `workers.dev` URL after deployment.

## Proxy contract

Any host can replace this Worker by implementing the same routes:

| Route | Method | Purpose |
| --- | --- | --- |
| `/?url=<encoded URL>` | GET/HEAD/POST/OPTIONS | Proxy an allowlisted YouTube/Google URL |
| `/auth/device` | POST | Request a TV sign-in code |
| `/auth/token` | POST | Exchange the device code for tokens |
| `/auth/refresh` | POST | Refresh an access token |
| `/stats` | POST | Send a playback record server-side |
| `/debug/log` | POST | Optional diagnostics; failures are ignored |

Requirements:

- allowlist `googlevideo.com`, `youtube.com`, `youtubei.googleapis.com` and
  `googleapis.com` (and their subdomains);
- add `Access-Control-Allow-Origin` and allow `Authorization`, `Content-Type`,
  `Range` and the `X-Goog-*` / `X-YouTube-*` headers;
- preserve `Range`/`206` responses;
- rewrite HLS manifests so every nested URI is proxied;
- serve over HTTPS (the app page is HTTPS and mixed content is blocked);
- accept a `ytrec` marker on a watchtime request and send the corresponding
  playback record before forwarding.

## Limits and notes

- Cloudflare Workers free tier has daily request limits. 1080p HLS uses many
  segment requests, so heavy daily viewing may hit them. A paid Workers plan or
  a small VPS avoids that.
- The Worker does not cache media. Signed YouTube URLs are short-lived; adding
  long-lived edge caching would be wrong for them.
- `Range`/`206` is preserved, so seeking works.
- This is a technical workaround, not an official YouTube API. YouTube can
  change the endpoints at any time.
- Do not remove the host allowlist or add an open URL parameter.
