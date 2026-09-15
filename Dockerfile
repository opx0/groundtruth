# Next.js standalone on Cloud Run.
#
# Three stages so the runtime image holds no toolchain and no dev dependency.
# The build needs pnpm and the whole dependency tree; the runtime needs
# `.next/standalone`, `.next/static` and `public`, and nothing else.
#
# No credential is baked in. AQS_EMAIL, AQS_KEY and AIRNOW_KEY are read from
# `process.env` at the point of use by their adapters, never at module load, so
# Cloud Run supplies them at start and an image pushed to a registry carries
# none of them.

FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs

# Cloud Run sends traffic to $PORT and the container must listen on every
# interface, not just loopback.
ENV PORT=8080 HOSTNAME=0.0.0.0
EXPOSE 8080
CMD ["node", "server.js"]
