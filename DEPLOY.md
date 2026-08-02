# Deploying Clarity to the Hostinger VPS

Replaces the old Render (backend) + Netlify (frontend) split. Everything now
runs on one box under Docker Compose, behind Caddy as a reverse proxy.

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

## Why the frontend needs a Node server

The app uses NextAuth plus a `proxy.ts` route guard, so it can't be exported as
static files the way Netlify was serving it. `next start` runs in a container.

---

## 1. DNS (skip if deploying on the bare IP)

Point an A record at the VPS **before** the first `docker compose up` — Caddy
requests the certificate on boot and needs the name to already resolve.

```
A    clarity.gorafeeq.com    76.13.188.48
```

Confirm it has propagated:

```bash
dig +short clarity.gorafeeq.com     # should print 76.13.188.48
```

Without a domain you can still deploy on `http://76.13.188.48`, but there will
be no HTTPS — a certificate cannot be issued for a bare IP.

## 2. Get the code onto the VPS

```bash
ssh root@76.13.188.48

apt update && apt install -y git
git clone https://github.com/tahamisb/clarity.git
cd clarity
```

The repo is private, so `git clone` will prompt for credentials. Use a GitHub
personal access token as the password, or add a deploy key.

Docker and Compose are already installed on this image — verify with
`docker compose version`.

## 3. Configure

```bash
cp .env.example .env
openssl rand -base64 32        # paste the output into AUTH_SECRET
nano .env
```

Fill in every blank. The two that matter most:

| With a domain | On the bare IP |
| --- | --- |
| `SITE_ADDRESS=clarity.gorafeeq.com` | `SITE_ADDRESS=:80` |
| `PUBLIC_URL=https://clarity.gorafeeq.com` | `PUBLIC_URL=http://76.13.188.48` |

No trailing slash on `PUBLIC_URL`.

## 4. Build and start

```bash
docker compose up -d --build
```

First build takes a few minutes — the Next.js compile is the slow part on 2
vCPUs. Then check it:

```bash
docker compose ps                   # all three services "running"
curl -sS localhost/health           # backend, through Caddy
docker compose logs -f caddy        # watch the cert get issued
```

Open `PUBLIC_URL` in a browser. Log in with any `@gorafeeq.com` address and the
`DEV_LOGIN_PASSWORD` you set.

## 5. Firewall

Hostinger's panel shows 0 firewall rules, which means nothing is being blocked
at their edge. If `ufw` is active on the VPS itself, open the web ports:

```bash
ufw status
ufw allow 80/tcp && ufw allow 443/tcp     # only if ufw reports "active"
```

---

## Redeploying

```bash
cd clarity && git pull && docker compose up -d --build
```

**Changing `PUBLIC_URL` or `NEXT_PUBLIC_ALLOWED_DOMAIN` requires a rebuild, not
just a restart.** Next.js inlines `NEXT_PUBLIC_*` into the client bundle at
build time; editing `.env` and running `docker compose restart` will leave the
old value baked into the JavaScript.

```bash
docker compose up -d --build frontend
```

## Notes on data

`backend/data/clarity.db` is generated inside the image at build time by
`scripts/generate_mock_db.py`, and the generator is seeded — every image gets
byte-identical data. There is nothing to back up and no volume to mount. When
real data lands, that changes: the database will need a named volume so it
survives rebuilds.

## Files this setup added

| File | Purpose |
| --- | --- |
| `docker-compose.yml` | The three services and their wiring |
| `Caddyfile` | Path routing + automatic TLS |
| `frontend/Dockerfile` | Multi-stage pnpm build, runs `next start` |
| `frontend/.dockerignore`, `backend/.dockerignore` | Keep build contexts small |
| `.env.example` | Template for the real `.env` |

`render.yaml` and `netlify.toml` are now unused and can be deleted once this is
confirmed working.

## Troubleshooting

**`UntrustedHost` on login** — `AUTH_URL` doesn't match the address in the
browser's URL bar. They have to be identical, scheme included.

**Charts empty, network tab shows 404s** — a backend path isn't routed in the
`Caddyfile`. Backend routes live under `/api/*`, `/calls`, `/analyse*`,
`/analytics/*`, `/predict*`, and `/health`; anything added outside those
prefixes needs its own `handle` block. Watch for collisions with Next.js pages
when you add one — `/cancellations` is a *page*, while the backend's
cancellation API is at `/api/cancellation/` (singular).

**Backend container exits immediately** — `GEMINI_API_KEY` is unset. It has no
default in `app/config.py`, so pydantic raises at startup. `docker compose logs
backend` will say so.

**Cert never issues** — DNS isn't resolving to the VPS yet, or port 80 is
blocked. Let's Encrypt validates over port 80 even for an HTTPS cert.
