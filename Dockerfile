# QUILL GUARD — bot + worker image
# Build:  docker build -t quill-guard .
# Run:    docker run --env-file .env quill-guard                 (sharded bot)
#         docker run --env-file .env quill-guard node dist/worker.js   (worker)

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/bot/package.json apps/bot/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter "@quill/bot..."
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/bot ./apps/bot
RUN pnpm --filter @quill/bot build \
  && pnpm --filter @quill/bot deploy --prod --legacy /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S quill && adduser -S quill -G quill
COPY --from=build --chown=quill:quill /out ./
USER quill
CMD ["node", "dist/index.js"]
