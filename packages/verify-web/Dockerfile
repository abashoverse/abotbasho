FROM oven/bun:1.1-alpine AS builder
WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY bun.lock* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/verify-web/package.json ./packages/verify-web/

RUN bun install

COPY packages/shared/ ./packages/shared/
COPY packages/verify-web/ ./packages/verify-web/

WORKDIR /app/packages/verify-web
RUN bun run build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=builder /app/packages/verify-web/build ./build
COPY --from=builder /app/packages/verify-web/package.json ./
COPY --from=builder /app/node_modules ./node_modules

ENV PORT=3000
ENV HOST=0.0.0.0
EXPOSE 3000
CMD ["node", "build/index.js"]
