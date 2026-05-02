FROM oven/bun:1.1-alpine AS base
WORKDIR /app

# Workspace metadata first for layer caching
COPY package.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/indexer/package.json ./packages/indexer/
COPY packages/discord/package.json ./packages/discord/
COPY packages/twitter/package.json ./packages/twitter/

# Lockfile is optional on first build
COPY bun.lockb* ./

RUN bun install

# Source + project config
COPY packages/ ./packages/
COPY abotbasho.config.ts ./

EXPOSE 42069
