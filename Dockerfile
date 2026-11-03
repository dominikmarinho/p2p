# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/webplayer/package.json ./apps/webplayer/package.json
RUN npm ci --no-audit --no-fund

FROM dependencies AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build:server

FROM dependencies AS web-build
ARG APP_REVISION=local
ENV APP_REVISION=$APP_REVISION
COPY apps/webplayer ./apps/webplayer
COPY scripts/build-web.mjs scripts/patch-p2p.mjs ./scripts/
RUN npm run build:web

FROM node:22-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/webplayer/package.json ./apps/webplayer/package.json
RUN npm ci --omit=dev --workspaces=false --no-audit --no-fund && npm cache clean --force

FROM node:22-bookworm-slim AS production
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg chromium ca-certificates && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /cache/vod && chown node:node /cache/vod
ENV NODE_ENV=production CHROMIUM_PATH=/usr/bin/chromium VOD_CACHE_DIR=/cache/vod XDG_CONFIG_HOME=/tmp/chromium-config XDG_CACHE_HOME=/tmp/chromium-cache
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json drizzle.config.ts ./
COPY --chown=node:node drizzle ./drizzle
COPY --chown=node:node public ./public
COPY --from=web-build --chown=node:node /app/public/player ./public/player
LABEL org.opencontainers.image.source="https://github.com/dominikmarinho/p2p"
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health/ready',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/server.js"]
