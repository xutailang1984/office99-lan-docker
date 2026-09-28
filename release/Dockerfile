# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    WEB_ROOT=/app/web \
    SAVE_FILE=/data/save.json

WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

COPY server/server.mjs ./
COPY server/platform/ ./platform/
COPY server/survival/ ./survival/
COPY web/ /app/web/
COPY docker/healthcheck.mjs /app/docker/healthcheck.mjs

# A healthy API with a missing Godot export is not a playable release.
RUN test -s /app/web/index.html \
    && test -s /app/web/play.html \
    && test -s /app/web/index.js \
    && test -s /app/web/index.wasm \
    && test -s /app/web/index.pck \
    && test -s /app/web/platform/app.mjs \
    && test -s /app/web/platform/host-worker.mjs \
    && test -s /app/web/platform/balance.json \
    && node -e "const f=require('fs');for(const n of ['index.html','play.html']){if(!/^<!doctype html>/i.test(f.readFileSync('/app/web/'+n,'utf8')))process.exit(1)}if(!f.readFileSync('/app/web/index.js','utf8').startsWith('var Godot='))process.exit(1)" \
    && mkdir /data \
    && chown node:node /data

USER node
EXPOSE 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=8s --start-period=20s --retries=3 \
    CMD ["node", "/app/docker/healthcheck.mjs"]
CMD ["node", "server.mjs"]
