# --- build stage --------------------------------------------------------
FROM node:22-bookworm-slim AS build

WORKDIR /app

# better-sqlite3 needs build tools to compile its native module
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

# --- runtime stage ------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/data/spyads.db

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data \
    && useradd -m -u 10001 spyads \
    && chown -R spyads:spyads /data

# Next.js standalone output already bundles node_modules it needs
COPY --from=build --chown=spyads:spyads /app/.next/standalone ./
COPY --from=build --chown=spyads:spyads /app/.next/static ./.next/static
COPY --from=build --chown=spyads:spyads /app/public ./public

USER spyads
VOLUME ["/data"]
EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
