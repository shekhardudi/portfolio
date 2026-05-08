# syntax=docker/dockerfile:1.7
# Multi-stage Next.js standalone build for the portfolio web app.

ARG NODE_VERSION=20-alpine

# ---------- deps ----------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---------- builder ----------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
RUN corepack enable

ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_INTELLI_SEARCH_API
ARG NEXT_PUBLIC_AGENTIC_HR_API
ARG NEXT_PUBLIC_LINKEDIN_API
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL} \
    NEXT_PUBLIC_INTELLI_SEARCH_API=${NEXT_PUBLIC_INTELLI_SEARCH_API} \
    NEXT_PUBLIC_AGENTIC_HR_API=${NEXT_PUBLIC_AGENTIC_HR_API} \
    NEXT_PUBLIC_LINKEDIN_API=${NEXT_PUBLIC_LINKEDIN_API} \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ---------- runner ----------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public            ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone  ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static      ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
