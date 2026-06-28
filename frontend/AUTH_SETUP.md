# Admin Authentication Setup

The dashboard is now gated behind Google sign-in. **Only `@gorafeeq.com` Google
accounts can log in. There is no sign-up flow** — access is login-only and is
enforced server-side.

> ## ⚠️ CURRENT STATE: placeholder login active (as of 2026-06-17)
>
> We do **not** yet have Google OAuth credentials (`AUTH_GOOGLE_ID` /
> `AUTH_GOOGLE_SECRET` are blank — waiting on a managed OAuth client from IT).
> Until then there is a **temporary placeholder login**: a NextAuth
> **Credentials** provider that accepts **any `@gorafeeq.com` email + a shared
> password**.
>
> ```
> DEV_LOGIN_PASSWORD=rafeeq        # in frontend/.env — share with the team
> NEXT_PUBLIC_AUTH_BYPASS=false    # full bypass is OFF; the login screen is real
> ```
>
> - The login screen at `/login` shows an email + password form.
> - Sign in with e.g. `t.mutahir@gorafeeq.com` and the password above.
> - The domain check is enforced server-side in the Credentials `authorize()`
>   ([`auth.ts`](auth.ts)); non-gorafeeq emails and wrong passwords are rejected.
> - The Google button only appears once `AUTH_GOOGLE_ID` is set.
>
> **Nothing about the real auth system was deleted.** To switch to Google SSO:
> fill in the two Google credentials below, **remove the `Credentials` provider
> in [`auth.ts`](auth.ts)** (and optionally `DEV_LOGIN_PASSWORD`), then restart.
> The Google button reappears automatically.
>
> There is also a legacy full bypass (`NEXT_PUBLIC_AUTH_BYPASS=true`) that skips
> the login screen entirely — left in place but off by default.

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
3. Add the **Authorized redirect URI** (local dev only — we don't have a prod URL yet):
   - `http://localhost:3000/api/auth/callback/google  `
   - When we deploy later, add the prod callback (`https://<domain>/api/auth/callback/google`) here too.
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
