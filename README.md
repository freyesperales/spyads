# spyads

> Spy on any brand's ads in 30 seconds. Free public ad-library lookup with Meta + Google support, built as a lead-magnet web app.

`spyads` is a small Next.js 16 app: a marketer enters a brand name, we hit the public ad libraries (Meta Ad Library, Google Ads Transparency Center) live, stream progress over SSE, and render every ad we found as a downloadable report. The email gate captures it as a lead in SQLite; the `/admin` page exports leads as CSV.

```
landing  →  email gate  →  /scan/[id]  ←—SSE—  orchestrator  →  scrapers
                                  ↓
                               SQLite  ←—admin /admin + CSV
```

## What's in the box

- **Landing page** (`/`) — confident headline, single CTA above the fold, sample brands, "how it works" and FAQ
- **Scan flow** (`/scan/[id]`) — live SSE progress, then a filterable card grid (by platform, by format) and CSV / JSON downloads
- **API**
  - `POST /api/scans` — zod-validated create, IP-rate-limited at 5/hour
  - `GET /api/scans/[id]` — current state + results
  - `GET /api/scans/[id]/events` — Server-Sent Events progress stream
  - `POST /api/admin/login` — sets HttpOnly HMAC-signed cookie
  - `GET /api/admin/leads?format=csv|json` — auth-gated export
- **Admin page** (`/admin`) — password gate (env `ADMIN_PASSWORD`), filterable leads table, one-click CSV export
- **DB** — SQLite via `better-sqlite3`, single `scans` table, indexed on email + created_at
- **Stub scrapers** — synthetic ads so the UI + lead capture work end-to-end before the real scrapers ship

## A note on the scrapers

This repo is the UI + lead-capture layer. Two sibling agents are building the real scrapers in parallel:

- `src/scrapers/meta.ts` — exports `MetaScraper`
- `src/scrapers/google.ts` — exports `GoogleScraper`

Until those land, `src/scrapers/index.ts` falls back to `StubScraper` for either source that's missing. The fallback is documented and intentional — the UI, DB and admin flow are fully functional in stub mode, and a real scraper drops in by just creating the file. **Each real scraper must:**
- export a class implementing the `Scraper` interface from `src/lib/types.ts`
- have a no-arg constructor (the loader in `src/scrapers/index.ts` calls `new MetaScraper()` / `new GoogleScraper()`)
- emit `ProgressEvent`s through `options.onProgress` so the SSE layer can broadcast them

## Run locally

```bash
npm install
cp .env.example .env.local        # set ADMIN_PASSWORD
npm run dev
# → http://localhost:3000
```

Tests + types:

```bash
npm run test         # vitest
npm run typecheck    # tsc --noEmit
```

## Environment variables

| Name | Default | Notes |
| --- | --- | --- |
| `ADMIN_PASSWORD` | `changeme` | Required to access `/admin`. CHANGE THIS IN PROD. |
| `DATABASE_PATH` | `./data/spyads.db` | Where SQLite lives. Mount this on a volume in containers. |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Used in canonical / OG links and CSV metadata. |

## Deploy: Docker (self-host)

```bash
docker compose up -d
# DB persists in the `spyads_data` volume mapped to /data inside the container
```

The image is multi-stage; the runtime image is `node:22-bookworm-slim` running the Next.js standalone output (no global `node_modules` needed). It runs as a non-root `spyads` user and uses `tini` as PID 1.

To bring your own reverse proxy, terminate TLS in front of the container on port 3000. **SSE needs `proxy_buffering off;`** in nginx (the route already sets `X-Accel-Buffering: no`, but nginx ignores that unless you opt in).

## Deploy: Railway

1. New project → "Deploy from repo".
2. Railway detects the Dockerfile and builds it.
3. Add a **Volume** at `/data` (so SQLite survives restarts).
4. Add env vars: `ADMIN_PASSWORD`, `NEXT_PUBLIC_SITE_URL=https://<your-railway-domain>`.
5. Set the **Service port** to `3000`.
6. Deploy. Visit the generated URL.

Railway's HTTP edge supports SSE out of the box — no extra config needed.

## Deploy: Fly.io

```bash
fly launch --no-deploy        # accepts Dockerfile, skips Postgres
fly volumes create spyads_data --size 1 --region <your-region>
fly secrets set ADMIN_PASSWORD="$(openssl rand -hex 24)"
fly deploy
```

Then edit `fly.toml` so the volume mounts at `/data`:

```toml
[mounts]
  source = "spyads_data"
  destination = "/data"

[http_service]
  internal_port = 3000
  force_https = true
```

Fly's edge supports long-lived HTTP / SSE; no tuning required for the traffic volumes a free-tier lead-magnet sees.

## Deploy: FastComet VPS (or any Linux VPS)

1. Install Docker + Compose:
   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER
   newgrp docker
   ```
2. Clone the repo to `/opt/spyads`.
3. Create `.env`:
   ```bash
   echo "ADMIN_PASSWORD=$(openssl rand -hex 24)" > .env
   echo "NEXT_PUBLIC_SITE_URL=https://spy.your-domain.tld" >> .env
   ```
4. `docker compose up -d --build`.
5. Front it with nginx — minimal config:
   ```nginx
   server {
     listen 443 ssl http2;
     server_name spy.your-domain.tld;
     ssl_certificate     /etc/letsencrypt/live/spy.your-domain.tld/fullchain.pem;
     ssl_certificate_key /etc/letsencrypt/live/spy.your-domain.tld/privkey.pem;

     location / {
       proxy_pass http://127.0.0.1:3000;
       proxy_http_version 1.1;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $remote_addr;
       proxy_buffering off;       # SSE
       proxy_read_timeout 3600s;  # SSE
     }
   }
   ```
6. `certbot --nginx -d spy.your-domain.tld`.

That's it. cPanel-Passenger Node hosting also works in theory but doesn't keep long-lived SSE connections cleanly across restarts — Docker is the right call on FastComet's VPS plans.

## Deploy: Vercel

Vercel works for the marketing pages, but the SSE route depends on a long-lived in-memory event bus, and serverless functions don't share memory across cold starts. Use the Docker / Railway / Fly / VPS paths above instead — or replace the in-memory bus in `src/lib/events.ts` with Redis pub/sub if you really want Vercel.

## Architecture details

### How the SSE flow works

When `POST /api/scans` runs, it inserts a `scans` row, fires `launchScan()` (background async), and returns the new scan ID. The background task drives `runScan()` which calls each `Scraper` in parallel and pipes every `ProgressEvent` into `emit(scanId, ...)` from `src/lib/events.ts`. That bus is a `Map<scanId, { history, listeners }>` kept in process memory.

On the client, `<ScanReport>` opens an `EventSource` to `/api/scans/[id]/events`. The route hands back a `ReadableStream` and calls `subscribe()` on the bus — every existing history entry is replayed first (so a page refresh mid-scan still sees what happened), then live events flow through until a `done` or `error` sentinel closes the stream. If the scan completed before the page even loaded, the GET handler short-circuits and sends a synthetic terminal event from the DB row. The orchestrator and the scrapers don't know SSE exists; they just call `onProgress`.

### Files worth reading first

- `src/lib/types.ts` — schema source of truth (don't edit)
- `src/lib/orchestrator.ts` — parallel runner, error-isolating
- `src/lib/events.ts` — in-memory pub/sub for SSE
- `src/lib/runner.ts` — glues scan persistence to the orchestrator
- `src/lib/email.ts` — Resend integration, graceful no-op when unset
- `src/lib/pdf.ts` — Playwright-driven PDF render of `/scan/[id]`
- `src/scrapers/index.ts` — real-or-stub loader

## Email delivery (Resend + PDF)

When a scan completes successfully, the runner fires a detached email task:

1. Open `${NEXT_PUBLIC_SITE_URL}/scan/[id]` in headless Chromium (Playwright reuses the browser instance the Google scraper would have launched anyway).
2. `page.pdf({ format: 'A4', printBackground: true })` → buffer.
3. POST to Resend's HTTP API with the PDF attached + a small HTML body linking back to the online report.

Graceful degradation:

- **No `RESEND_API_KEY` / `EMAIL_FROM`** → email step logs `[email] skipping send` and the scan flow is unaffected. The user still sees the report on screen.
- **No Chromium installed** → PDF step logs the failure, then email is sent without an attachment (link-only).
- **Resend rejects** (bad domain, quota) → logged + returns false, never throws.

Setup:

```bash
# 1. Install Chromium once for the PDF renderer (also used by the Google scraper)
npx playwright install chromium

# 2. Sign up at https://resend.com (free 3,000/mo, 100/day)
#    Verify a sender domain (5-min DNS step)

# 3. Set the env vars in .env
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxx
EMAIL_FROM="spyads <reports@your-domain.com>"
NEXT_PUBLIC_SITE_URL=https://spyads.io   # so the PDF renders the right host
```

Want classic SMTP instead? `src/lib/email.ts` is the only file you'd rewrite — drop in `nodemailer` and reuse the same `sendScanReport(opts)` signature.

## Scope cuts (things I deliberately punted)

- Multi-process / horizontal scale — the SSE bus and rate limiter both live in process memory. Single-node deploys are fine; for horizontal scale, swap both for Redis.
- Drip / follow-up sequences — only one email is sent (the report). Weekly tracking / "we noticed X new ads since last scan" is a v0.2 idea.
- Real social-proof logos — the landing page shows brand-name badges as a placeholder.
- Mobile hamburger menu — the header just hides nav links below `sm`, which is enough for a landing page but not a real app.
- Test coverage of API routes — the test suite focuses on the orchestrator (the most failure-prone piece). API routes are covered by manual smoke testing during build.

## License

MIT.
