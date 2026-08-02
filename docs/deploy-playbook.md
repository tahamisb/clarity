# Deploy playbook: FastAPI on Render + Next.js on Netlify

Handoff notes for an agent deploying a similar split (Python API + JS frontend,
separate hosts, browser talks to the API cross-origin). Written from a real
deployment; every "gotcha" below is one that actually cost time.

Replace `API_HOST` / `SITE_HOST` with the real hostnames.

---

## Part 1 — Backend on Render (Docker)

### 1.1 The Dockerfile must bind `$PORT`

This is the single most common cause of "deploy succeeded, service unhealthy".
Render assigns a port at runtime (usually 10000) and routes traffic **only**
there. `EXPOSE` is documentation; it changes nothing.

```dockerfile
# WRONG — deploys fine, then fails health checks forever
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]

# RIGHT — shell form so $PORT expands; keeps a local default
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8001}"]
```

JSON/exec form does **not** expand variables. It must be shell form (or an
entrypoint script) for `${PORT}` to mean anything.

Confirm in the deploy log:

```
INFO: Uvicorn running on http://0.0.0.0:10000
```

If that says 8001, traffic will never reach it.

### 1.2 Blueprint

`render.yaml` at the repo root:

```yaml
services:
  - type: web
    name: my-api
    runtime: docker
    rootDir: backend          # omit if the Dockerfile is at the repo root
    dockerfilePath: ./Dockerfile
    plan: free
    healthCheckPath: /health  # must be a real 200 route, or deploys roll back
    envVars:
      - key: SOME_API_KEY
        sync: false           # prompts at setup, never stored in git
      - key: CORS_ORIGINS
        value: https://SITE_HOST
```

Then: Render → New → Blueprint → pick the repo.

**`sync: false` has a trap.** It prompts for a value at blueprint setup. If the
value is left blank you get an **empty string, not an error**. For a secret that
fails loudly at boot; for something like `CORS_ORIGINS` it fails *silently* —
`"".split(",") == [""]`, which matches no origin and blocks every browser
request while the server keeps returning 200. Use `value:` for anything that
isn't secret.

### 1.3 Generating data at build time

If the app reads a generated artifact (seeded SQLite, an index, a fixture set),
build it in the image rather than at boot:

```dockerfile
RUN python scripts/generate_db.py
```

Files written during `docker build` persist in the image, so every container
starts with identical data and boot stays fast. The container filesystem is
**ephemeral** — fine for regenerated/read-only data, useless for anything users
write. Real writes need a managed database.

### 1.4 Free tier

Sleeps after ~15 min idle; first request after that takes ~50s. Acceptable for a
demo, not for a live call. `healthCheckPath` pings do not prevent sleeping.

---

## Part 2 — Frontend on Netlify (Next.js)

`netlify.toml` at the repo root:

```toml
[build]
  base = "frontend"     # omit for a single-app repo
  command = "pnpm build"
  publish = ".next"

[build.environment]
  NODE_VERSION = "22"

[[plugins]]
  package = "@netlify/plugin-nextjs"
```

### 2.1 `NEXT_PUBLIC_*` is baked in at build time

It is substituted into the JS bundle during `next build`, not read at runtime.
Setting it in the dashboard does nothing to an already-built site — **you must
redeploy after changing it.** Same for any `VITE_*` / `PUBLIC_*` equivalent.

### 2.2 One lockfile only

Netlify picks the package manager by which lockfile it finds. A repo containing
both `package-lock.json` and `pnpm-lock.yaml` may install a different dependency
tree than the one tested locally. Delete the one not in use.

### 2.3 Env vars for a Next.js + Auth.js app

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend origin, no trailing slash |
| `AUTH_SECRET` | Generate fresh — never reuse the dev value |
| `AUTH_URL` | The deployed site URL |

---

## Part 3 — Wiring them together

Deploy order, because each needs the other's URL:

1. Deploy the backend, note `https://API_HOST`
2. Set `NEXT_PUBLIC_API_URL=https://API_HOST` in Netlify, deploy the frontend
3. Set `CORS_ORIGINS=https://SITE_HOST` on the backend, restart

### 3.1 CORS: the format is exact

An `Origin` header is always **scheme + host + port**. Most CORS middleware
compares it as an exact string, so all of these silently match nothing:

```
SITE_HOST                    # no scheme        -> never matches
https://SITE_HOST/           # trailing slash   -> never matches
http://SITE_HOST             # wrong scheme     -> never matches
https://SITE_HOST            # correct
```

`localhost` and `127.0.0.1` are different origins. So is the LAN IP that dev
servers print as "Network:". List every one you actually browse from.

Deploy previews get unique hostnames and will each be blocked. If you need them,
use a regex instead of a list (FastAPI: `allow_origin_regex`).

---

## Part 4 — Debugging "deployed fine but no data"

The trap: **a CORS-blocked request still returns 200 to the server.** The server
logs look perfectly healthy — the *browser* discards the response after it
arrives. If the frontend also swallows fetch errors (`catch { return null }`,
very common), empty panels render instead of an error, and a permissions problem
becomes indistinguishable from an empty dataset.

Work through it in this order. Each step is one command and rules out a layer.

**1. Is the API alive and does it have data?**

```bash
curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" https://API_HOST/health
curl -s "https://API_HOST/some-endpoint" | head -c 300
```

**2. What API URL is actually compiled into the deployed frontend?**

Do not trust the dashboard — read the shipped bundle. This catches an unset or
stale `NEXT_PUBLIC_*` immediately:

```bash
curl -s https://SITE_HOST/ -o page.html
grep -o '/_next/static/chunks/[^"]*\.js' page.html | sort -u > list.txt
while read -r c; do curl -s "https://SITE_HOST$c"; done < list.txt > all.js
grep -o "https://[a-z0-9.-]*\.onrender\.com" all.js | sort -u
grep -o "localhost:[0-9]*" all.js | sort -u      # a hit here = env var missing
```

**3. Is CORS the blocker?** The decisive test — send the exact `Origin` the
browser sends and look for the response header:

```bash
curl -s -D- -o /dev/null -H "Origin: https://SITE_HOST" \
  "https://API_HOST/some-endpoint" | grep -i "access-control-allow-origin"
```

- Header present and echoes your origin → CORS is fine, look elsewhere
- **No header at all → the browser is blocking every response.** This is the
  answer even though the status line says `200 OK`

Bisect the value by trying variants (`with/without scheme`, `trailing slash`) —
whichever one returns the header tells you exactly how the env var is malformed.

**4. Still nothing?** Open DevTools → Console/Network. Add a `console.warn` in
the shared fetch wrapper before doing anything else; a wrapper that returns
`null` on error makes every failure invisible and costs far more time than the
one line:

```ts
} catch (err) {
  console.warn(`[api] request failed: ${url}`, err)
  return null
}
```

---

## Checklist

Backend:
- [ ] `CMD` binds `${PORT}` in shell form
- [ ] Deploy log shows Uvicorn on Render's port, not the hardcoded one
- [ ] `healthCheckPath` is a real 200 route
- [ ] `CORS_ORIGINS` has scheme, no trailing slash, covers every browsing origin
- [ ] No `sync: false` on a non-secret that fails silently when blank

Frontend:
- [ ] Exactly one lockfile
- [ ] `NEXT_PUBLIC_*` set **and** redeployed afterwards
- [ ] Fresh `AUTH_SECRET`, correct `AUTH_URL`
- [ ] Verified the API URL inside the built bundle, not just the dashboard
