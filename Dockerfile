# Next.js standalone on Cloud Run, built and run with Bun.
#
# Three stages so the runtime image holds no toolchain and no dev dependency.
# The build needs bun and the whole dependency tree; the runtime needs
# `.next/standalone`, `.next/static` and `public`, and nothing else.
#
# `oven/bun` carries no node binary, so every step has to be one bun can run
# by itself. `bun run build` executes Next's CLI on the bun runtime rather
# than through its `#!/usr/bin/env node` shebang, and the final stage starts
# `server.js` the same way.
#
# No credential is baked in. AQS_EMAIL, AQS_KEY and AIRNOW_KEY are read from
# `process.env` at the point of use by their adapters, never at module load, so
# Cloud Run supplies them at start and an image pushed to a registry carries
# none of them.

FROM oven/bun:1.4-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.4-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

FROM oven/bun:1.4-alpine AS runner
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
CMD ["bun", "server.js"]
