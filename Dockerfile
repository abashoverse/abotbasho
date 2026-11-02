FROM oven/bun:1.1-alpine AS base
WORKDIR /app

# Fonts for rendering on-chain SVG art to PNG (resvg). Alpine ships none, so
# any <text> in a token's SVG would silently vanish from the posted image.
RUN apk add --no-cache font-dejavu

# Workspace metadata first for layer caching
COPY package.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/indexer/package.json ./packages/indexer/
COPY packages/discord/package.json ./packages/discord/
COPY packages/twitter/package.json ./packages/twitter/
COPY packages/telegram/package.json ./packages/telegram/

# Lockfile is optional on first build. Match both formats: `bun.lock` (text,
# current default) and `bun.lockb` (older binary). Wildcard means missing
# lockfile is non-fatal.
COPY bun.lock* ./

RUN bun install

# Source + project config
COPY packages/ ./packages/
COPY abotbasho.config.ts ./

EXPOSE 42069

# The indexer runs Ponder, which only supports Node (`engines.node`). In the
# Bun image, `node` resolves to Bun, so Ponder used to run on Bun without
# anyone noticing. Same pattern as verify-web: Bun installs, Node runs.
# Ponder loads the TypeScript sources (its own files, @abotbasho/shared,
# abotbasho.config.ts) through vite-node, so no build step is needed.
FROM node:22-alpine AS indexer
WORKDIR /app
COPY --from=base /app ./
WORKDIR /app/packages/indexer
EXPOSE 42069
CMD ["node", "/app/node_modules/ponder/dist/esm/bin/ponder.js", "start"]
