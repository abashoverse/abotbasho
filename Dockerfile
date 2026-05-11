FROM oven/bun:1.1-alpine AS base
WORKDIR /app

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
