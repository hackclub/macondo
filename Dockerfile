# syntax=docker/dockerfile:1.7

FROM dhi.io/node:24-alpine3.24-dev AS builder
WORKDIR /app

RUN --mount=type=cache,target=/var/cache/apk,sharing=locked \
    apk add --cache-dir /var/cache/apk python3 make g++ ca-certificates curl unzip \
    && npm install --global node-gyp@11.4.2 \
    && case "$(uname -m)" in aarch64) bun_arch=aarch64 ;; x86_64) bun_arch=x64 ;; *) exit 1 ;; esac \
    && curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-linux-${bun_arch}-musl.zip" -o /tmp/bun.zip \
    && unzip -q /tmp/bun.zip -d /tmp/bun \
    && install -m 755 "/tmp/bun/bun-linux-${bun_arch}-musl/bun" /usr/local/bin/bun \
    && rm -rf /tmp/bun /tmp/bun.zip \
    && bun --version

COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

COPY . .

ENV NODE_ENV=production \
    NUXT_TELEMETRY_DISABLED=1 \
    NUXT_FORCE_EXIT_AFTER_BUILD=1 \
    NODE_OPTIONS="--max-old-space-size=4096"

RUN --mount=type=cache,target=/app/node_modules/.cache \
    --mount=type=cache,target=/app/node_modules/.vite \
    --mount=type=cache,target=/root/.cache \
    ./node_modules/.bin/nuxt build \
    && bun build docker/migrate.ts --target=node --outfile=migrate.mjs \
    && bun build docker/runtime-env.ts --target=node --outfile=runtime-env.mjs

RUN case "$(uname -m)" in aarch64) sharp_arch=arm64 ;; x86_64) sharp_arch=x64 ;; *) exit 1 ;; esac \
    && cp -a "node_modules/@img/sharp-linuxmusl-${sharp_arch}" \
       "node_modules/@img/sharp-libvips-linuxmusl-${sharp_arch}" \
       .output/server/node_modules/@img/

FROM dhi.io/node:24-alpine3.24-dev AS runtime-tools
RUN --mount=type=cache,target=/var/cache/apk,sharing=locked \
    apk add --cache-dir /var/cache/apk curl ca-certificates \
    && mkdir -p /runtime/etc/apk/keys \
    && cp /etc/apk/keys/* /runtime/etc/apk/keys/ \
    && cp /etc/apk/repositories /runtime/etc/apk/repositories \
    && curl -sLf --retry 3 --tlsv1.2 --proto "=https" \
       "https://packages.doppler.com/public/cli/rsa.8004D9FF50437357.key" \
       -o /runtime/etc/apk/keys/cli@doppler-8004D9FF50437357.rsa.pub \
    && echo "https://packages.doppler.com/public/cli/alpine/any-version/main" \
       >> /runtime/etc/apk/repositories \
    && apk --root /runtime --initdb --no-scripts --no-cache add \
       busybox curl ca-certificates git tini libstdc++ doppler \
    && ln -s busybox /runtime/bin/timeout \
    && cp /etc/ssl/certs/ca-certificates.crt /runtime/etc/ssl/certs/ \
    && rm -rf /runtime/etc/apk /runtime/lib/apk /runtime/var

FROM dhi.io/node:24-alpine3.24 AS runtime
WORKDIR /app

COPY --from=runtime-tools /runtime/ /

COPY --from=builder /app/.output ./.output
COPY --from=builder /app/migrate.mjs ./migrate.mjs
COPY --from=builder /app/runtime-env.mjs ./runtime-env.mjs
COPY --from=builder /app/drizzle ./drizzle

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DOPPLER_PROJECT=codename-lynx

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

COPY --chmod=755 <<'EOF' /usr/local/bin/entrypoint.sh
#!/bin/sh
set -e
export DOPPLER_CONFIG=$([ "$NODE_ENV" = "production" ] && echo prd || echo dev)
if [ -n "${NUXT_DATABASE_URL:-}" ]; then
  export DATABASE_URL="$NUXT_DATABASE_URL"
elif [ -n "${DATABASE_URL:-}" ]; then
  export NUXT_DATABASE_URL="$DATABASE_URL"
fi
if [ "$SKIP_DB_MIGRATE" != "1" ]; then
  echo "[entrypoint] running Drizzle migrations (max 120s)..."
  if ! timeout 120s doppler run --preserve-env=DATABASE_URL,NUXT_DATABASE_URL -- node migrate.mjs; then
    echo "[entrypoint] migration failed or timed out; exiting non-zero"
    exit 1
  fi
  echo "[entrypoint] migrations applied"
else
  echo "[entrypoint] skipping migrations (SKIP_DB_MIGRATE=1 set)"
fi
echo "[entrypoint] starting nitro server"
exec doppler run --preserve-env=DATABASE_URL,NUXT_DATABASE_URL -- node --import ./runtime-env.mjs .output/server/index.mjs
EOF

USER 1000:1000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/usr/local/bin/entrypoint.sh"]
