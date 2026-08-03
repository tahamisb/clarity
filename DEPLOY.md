# Deploying Clarity to the Hostinger VPS

Live at **https://interns26.cloud**. Replaces the old Render (backend) +
Netlify (frontend) split — everything runs on one box under Docker Compose,
behind Caddy as a reverse proxy.

```
                    ┌──────────── VPS 76.13.188.48 ────────────┐
  browser ──:443──► │  caddy ──┬──► frontend (Next.js :3000)   │
                    │          └──► backend  (FastAPI :8001)   │
                    └──────────────────────────────────────────┘
```

Both services sit behind a **single public origin**. The browser never makes a
cross-origin request, so CORS — the thing that made the Render/Netlify split
fiddly — stops being a concern. Only Caddy publishes ports; `frontend` and
`backend` are reachable only on the internal Docker network.

The app lives in **`/opt/clarity`** on the VPS, as a plain git clone.

## Do NOT use Hostinger's Docker Manager for this

It cost an hour of debugging, so it is worth stating plainly. The panel's
Compose flow syncs `docker-compose.yml` and creates *empty* directories for any
build context the file references. It does not ship your source. The result:

- `backend/` and `frontend/` arrived empty; `caddy/Dockerfile` synced but
  `caddy/Caddyfile` did not.
- The first deploy still reported "Running" because Docker's layer cache
  satisfied the `RUN` steps while every `COPY` silently had nothing to copy.
- Failures surfaced later as unrelated-looking errors (`"/Caddyfile": not
  found`, `"/pnpm-workspace.yaml": not found`).

The panel is built for pulling prebuilt images from a registry. This compose
file builds from local source, so it needs a real checkout. Clone the repo and
run `docker compose` yourself.

If a `clarity` app still exists in Docker Manager, delete it — two systems
competing for ports 80/443 will break this one.

## Why the frontend needs a Node server

The app uses NextAuth plus a `proxy.ts` route guard, so it can't be exported as
static files the way Netlify was serving it. `next start` runs in a container.

---

## 1. DNS

Point an A record at the VPS **before** the first `docker compose up` — Caddy
requests the certificate on boot and needs the name to already resolve.

```
A    interns26.cloud        76.13.188.48
A    www.interns26.cloud    76.13.188.48
```

A wildcard (`A  *  76.13.188.48`) is worth adding — it covers every future
subdomain in one shot, so a second project needs no DNS work at all.

Confirm before deploying:

```bash
dig +short interns26.cloud     # should print 76.13.188.48
```

## 2. Get the code onto the VPS

```bash
ssh root@76.13.188.48
apt update && apt install -y git
git clone https://github.com/tahamisb/clarity.git /opt/clarity
cd /opt/clarity
```

Docker and Compose are preinstalled on this image — verify with
`docker compose version`.

## 3. Configure

```bash
cat > .env <<EOF
SITE_ADDRESS=interns26.cloud, www.interns26.cloud
PUBLIC_URL=https://interns26.cloud
AUTH_SECRET=$(openssl rand -base64 32)
NEXT_PUBLIC_ALLOWED_DOMAIN=example.com
DEV_LOGIN_PASSWORD=changeme
GEMINI_API_KEY=
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=t.mutahir@gorafeeq.com
SMTP_PASSWORD=
WAITLIST_NOTIFY_TO=t.mutahir@gorafeeq.com
EOF
```

`SITE_ADDRESS` takes a comma-separated list; Caddy issues a certificate per
name. No trailing slash on `PUBLIC_URL`.

The `SMTP_*` block is what emails "Unlock full version" signups — see
[Waitlist email](#waitlist-email). Leaving `SMTP_PASSWORD` blank is a valid
deploy: signups are still recorded, just never emailed.

To deploy on the bare IP instead (no HTTPS — a certificate cannot be issued for
an IP), use `SITE_ADDRESS=:80` and `PUBLIC_URL=http://76.13.188.48`.

## 4. Build and start

```bash
docker compose up -d --build
```

First build takes a few minutes — the Next.js compile is the slow part on 2
vCPUs. Then:

```bash
docker compose ps                   # all three "running"
curl -sS localhost/health           # backend, through Caddy
docker compose logs -f caddy        # wait for "certificate obtained successfully"
```

## 5. Firewall

Hostinger's panel shows 0 firewall rules, so nothing is blocked at their edge.
If `ufw` is active on the VPS itself, open the web ports:

```bash
ufw status
ufw allow 80/tcp && ufw allow 443/tcp     # only if ufw reports "active"
```

---

## Redeploying

```bash
cd /opt/clarity && git pull && docker compose up -d --build
```

**Changing `PUBLIC_URL` or `NEXT_PUBLIC_ALLOWED_DOMAIN` requires a rebuild, not
a restart.** Next.js inlines `NEXT_PUBLIC_*` into the client bundle at build
time; editing `.env` and running `docker compose restart` leaves the old value
baked into the JavaScript.

Caddy routing changes also need `--build`, since `caddy/Caddyfile` is copied
into the image rather than mounted. `SITE_ADDRESS` is the exception — it's read
from the environment at runtime, so switching domains only needs a restart.

The `SMTP_*` values are plain runtime environment, so changing them needs only
`docker compose up -d backend` — no rebuild.

## Adding a second project to this VPS

Subdomains are free and unlimited. Give the new project its own compose stack on
an internal port, then add a block to `caddy/Caddyfile`:

```
otherproject.interns26.cloud {
	reverse_proxy otherproject:3000
}
```

Each name gets its own certificate automatically. Avoid putting projects on
paths of one domain (`/clarity`, `/other`) — apps assume they own the root, so
asset URLs and auth cookies break, and all of them end up sharing cookies.

## Waitlist email

The sidebar's "Unlock full version" button opens the tiered upgrade modal
(`frontend/components/clarity/upgrade-modal.tsx`). Every tier reads "Talk to
sales" — there is no pricing and no checkout. Submitting captures the email,
optional company, and selected tier via `POST /api/v1/waitlist`, which stores
the row and emails it to `WAITLIST_NOTIFY_TO`.

A signup returns `201` whether or not email is configured, so check the deploy's
actual state:

```bash
curl -sS https://interns26.cloud/api/v1/waitlist/status
```

`smtp_configured: false` means signups are being stored but not emailed. If it's
`true` but nothing arrives, `last_send_error` in that same response carries the
reason the last attempt failed.

Gmail and Google Workspace reject account passwords over SMTP — `SMTP_PASSWORD`
must be an App Password (myaccount.google.com → Security → 2-Step Verification →
App passwords). Google displays it as `xxxx xxxx xxxx xxxx`; the spaces are
decoration and the backend strips them.

Read the captured signups:

```bash
docker compose exec backend python -c "import sqlite3; [print(r) for r in \
  sqlite3.connect('/app/data/clarity.db').execute( \
  'SELECT created_at,email,company,plan FROM waitlist ORDER BY created_at DESC')]"
```

## Notes on data

`backend/data/clarity.db` is generated inside the image at build time by
`scripts/generate_mock_db.py`, and the generator is seeded — every image gets
byte-identical analytics data.

The `waitlist` table is the exception: it's written at runtime, so `/app/data` is
a named volume (`backend_data`) to keep signups across rebuilds. Docker seeds an
empty volume from the image on first attach, so the mock warehouse still arrives.

The consequence is that **the volume wins once it exists** — rebuilding with
changed mock data will not reach a running deploy. To take new mock data:

```bash
docker compose down -v && docker compose up -d --build   # DROPS waitlist signups
```

Export the signups first (query above) if they matter.

## Files this setup added

| File | Purpose |
| --- | --- |
| `docker-compose.yml` | The three services and their wiring |
| `caddy/Caddyfile` | Path routing + automatic TLS |
| `caddy/Dockerfile` | Bakes the config in (no fragile bind mount) |
| `frontend/Dockerfile` | Multi-stage pnpm build, runs `next start` |
| `frontend/.dockerignore`, `backend/.dockerignore` | Keep build contexts small |
| `.env.example` | Template for the real `.env` |

`render.yaml` and `netlify.toml` are unused now and can be deleted.

## Troubleshooting

**`UntrustedHost` on login** — `AUTH_URL` doesn't match the address in the
browser's URL bar. They must be identical, scheme included.

**Charts empty, network tab shows 404s** — a backend path isn't routed in
`caddy/Caddyfile`. Backend routes live under `/api/*`, `/calls`, `/analyse*`,
`/analytics/*`, `/predict*`, and `/health`; anything outside those prefixes
needs its own `handle` block. Watch for collisions with Next.js pages —
`/cancellations` is a *page*, while the backend's cancellation API is at
`/api/cancellation/` (singular).

**`unrecognized global option: encode`** — `SITE_ADDRESS` is empty, so the
Caddyfile opens with a bare `{`, which Caddy reads as a global options block.
Check `.env` exists and is populated. Compose also prints
`WARN ... variable is not set` for every missing key, which is the faster tell.

**AI features fail at request time** — `GEMINI_API_KEY` is blank. Note the
container still *starts*: compose passes the variable as an empty string, which
satisfies pydantic's `str` type in `app/config.py`. A running backend does not
mean the key is set.

**Cert never issues** — DNS isn't resolving to the VPS, or port 80 is blocked.
Validation happens over port 80 even for an HTTPS certificate. If
`SITE_ADDRESS` lists multiple names, *all* of them must resolve; one bad `www`
record blocks the whole site block.

**ACME challenge warnings for a domain you didn't configure** — harmless.
Something else on the box (Hostinger's own provisioning) ordered a certificate;
our Caddy owns port 80 and receives the validation request, but has no matching
order, so it logs `no information found to solve challenge`.

**"Are you trying to mount a directory onto a file"** — Docker creates a host
bind path as an empty *directory* when it doesn't exist, then can't mount it
over a file. The Caddy config is baked into the image now specifically to avoid
this; if a stale `Caddyfile` directory is lying around, `rm -rf` it.
