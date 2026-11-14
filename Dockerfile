# syntax=docker/dockerfile:1

# ---- build ---------------------------------------------------------------
# Everything the client and the bundled server need, then thrown away.
FROM node:26.13.1-bookworm-slim AS build
WORKDIR /app

# Dependencies first, so a source change does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts ./
COPY client ./client
COPY server ./server
COPY shared ./shared
RUN npm run build

# ---- runtime -------------------------------------------------------------
FROM node:26.13.1-bookworm-slim AS runtime

ENV NODE_ENV=production \
    BOLTBOOK_DATA_DIR=/data \
    BOLTBOOK_HOST=0.0.0.0 \
    BOLTBOOK_PORT=8080

WORKDIR /app

# The server bundle carries its own dependencies (esbuild --packages=bundle),
# so there is no node_modules in the image at all: node, the bundle, the client.
COPY --from=build /app/dist ./dist

RUN mkdir -p /data && chown -R node:node /data
USER node

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.BOLTBOOK_PORT || 8080) + '/api/status').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server.mjs"]
