# Admin Authentication Setup

The dashboard is now gated behind Google sign-in. **Only `@gorafeeq.com` Google
accounts can log in. There is no sign-up flow** — access is login-only and is
enforced server-side.

> ## ⚠️ CURRENT STATE: auth is BYPASSED (as of 2026-06-17)
>
> We do **not** yet have Google OAuth credentials (`AUTH_GOOGLE_ID` /
> `AUTH_GOOGLE_SECRET` are blank — waiting on a managed OAuth client from IT).
> To keep the app usable in the meantime, a **temporary bypass** is switched on:
>
> ```
> NEXT_PUBLIC_AUTH_BYPASS=true   # in frontend/.env
> ```
>
> While this is `true`, every route is reachable **without logging in**, and the
> top-right corner shows an amber **"Auth bypassed"** badge so it's obvious.
>
> **Nothing about the auth system was deleted** — the bypass is a single guard at
> the top of the `authorized` callback in [`auth.config.ts`](auth.config.ts) plus
> a matching badge in [`topbar.tsx`](components/rafeeq/topbar.tsx).
>
> **To re-enable real auth:** fill in the two Google credentials below, then set
> `NEXT_PUBLIC_AUTH_BYPASS=false` (or delete the line) and restart `pnpm dev`.
> That's the only change required.

## How it works

- **Auth.js (NextAuth v5)** with the Google provider — [`auth.config.ts`](auth.config.ts), [`auth.ts`](auth.ts).
- The `signIn` callback rejects any account whose verified email is not on
  `gorafeeq.com`.
- [`middleware.ts`](middleware.ts) protects every route. Unauthenticated users are
  redirected to [`/login`](app/login/page.tsx); logged-in users who hit `/login`
  are sent to the app.
- The signed-in user and a **Sign out** action appear in the top-right profile
  menu of every page.

## One-time Google setup

1. Go to <https://console.cloud.google.com/apis/credentials>.
2. **Create credentials → OAuth client ID → Web application**.
3. Add the **Authorized redirect URI**:
   - Dev: `http://localhost:3000/api/auth/callback/google`
   - Prod: `https://<your-domain>/api/auth/callback/google`
4. Copy the **Client ID** and **Client secret** into [`.env`](.env):

   ```
   AUTH_GOOGLE_ID=<client id>
   AUTH_GOOGLE_SECRET=<client secret>
   ```

5. `AUTH_SECRET` is already generated in `.env`. In production, set a fresh one
   and set `AUTH_URL` to the deployed URL.

> Tip: to lock the OAuth consent screen to gorafeeq.com only, configure it as an
> **Internal** app inside the gorafeeq.com Google Workspace. The `hd=gorafeeq.com`
> hint is already sent on every sign-in request, and the server-side domain check
> is the real enforcement either way.

## Run

```
pnpm dev
```

Then open <http://localhost:3000> — you'll be redirected to `/login`.
