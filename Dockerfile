ARG RUNTIME_BASE_IMAGE=custeio-runtime-base:node22

FROM ${RUNTIME_BASE_IMAGE} AS runtime-base

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS builder
# `NEXT_PUBLIC_*` values are inlined into the client bundle at build time, so the
# browser DSN has to arrive as a build arg — passing it only at runtime ships a
# bundle with Sentry disabled. `SENTRY_ORG`/`SENTRY_PROJECT` feed the webpack
# plugin in next.config.mjs. No auth token here on purpose: it is a secret and
# without it the plugin simply skips the source-map upload.
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE="0"
ARG NEXT_PUBLIC_SENTRY_REPLAY_SAMPLE_RATE="0"
ARG NEXT_PUBLIC_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE="0"
ARG SENTRY_ORG=""
ARG SENTRY_PROJECT=""
ENV NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN} \
    NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=${NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE} \
    NEXT_PUBLIC_SENTRY_REPLAY_SAMPLE_RATE=${NEXT_PUBLIC_SENTRY_REPLAY_SAMPLE_RATE} \
    NEXT_PUBLIC_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE=${NEXT_PUBLIC_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE} \
    SENTRY_ORG=${SENTRY_ORG} \
    SENTRY_PROJECT=${SENTRY_PROJECT}
COPY . .
RUN npm run build

FROM runtime-base AS development
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000 8081
CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0", "-p", "3000"]

FROM runtime-base AS production
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/main.js ./main.js
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/app ./app
COPY --from=builder /app/tsconfig*.json ./
EXPOSE 3000 8081
CMD ["./node_modules/.bin/pm2-runtime", "start", "main.js", "--name", "app"]
