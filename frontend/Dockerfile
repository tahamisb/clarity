FROM node:22-slim AS builder

WORKDIR /app

# Lockfile is v9 → pnpm 10. Pinned so CI and the VPS resolve identically.
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

# .npmrc matters here: node-linker=hoisted. Turbopack's CSS resolver can't
# follow pnpm's symlinks, so `@import 'tailwindcss'` fails without it.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY . .

# NEXT_PUBLIC_* is inlined into the client bundle at BUILD time, not read from
# the container env at runtime. Changing either one means rebuilding the image.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_ALLOWED_DOMAIN
# Blank = live clock. Set only when serving the frozen SQLite snapshot,
# whose data stops on a fixed day — see lib/clock.ts.
ARG NEXT_PUBLIC_CLOCK_FROZEN_AT=""
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_ALLOWED_DOMAIN=$NEXT_PUBLIC_ALLOWED_DOMAIN
ENV NEXT_PUBLIC_CLOCK_FROZEN_AT=$NEXT_PUBLIC_CLOCK_FROZEN_AT

RUN pnpm build

FROM node:22-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

# `next start` needs exactly these. Copying the whole builder stage would drag
# in the source tree and dev-only deps for no benefit.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.mjs ./next.config.mjs

EXPOSE 3000

CMD ["pnpm", "start"]
