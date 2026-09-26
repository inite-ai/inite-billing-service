FROM node:24-alpine AS builder

WORKDIR /app

# Build args
ARG NEXT_PUBLIC_API_URL=http://localhost:3000
ARG NEXT_PUBLIC_AUTH_SERVICE_URL=https://auth.inite.ai
ARG NEXT_PUBLIC_OAUTH_CLIENT_ID=inite-billing
# The commit being built. Next uses it as the deployment id, so a tab still
# running an older build reloads itself instead of rendering stale code.
ARG DEPLOYMENT_VERSION=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_AUTH_SERVICE_URL=$NEXT_PUBLIC_AUTH_SERVICE_URL
ENV NEXT_PUBLIC_OAUTH_CLIENT_ID=$NEXT_PUBLIC_OAUTH_CLIENT_ID
ENV DEPLOYMENT_VERSION=$DEPLOYMENT_VERSION

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Build
RUN npm run build

# Production image
FROM node:24-alpine

# next.config.mjs is read again at start, and must give the same id.
ARG DEPLOYMENT_VERSION=
ENV DEPLOYMENT_VERSION=$DEPLOYMENT_VERSION

WORKDIR /app

# Copy built files
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.mjs ./next.config.mjs
# Blog MDX is read from disk at runtime (next-mdx-remote), so it must ship.
COPY --from=builder /app/content ./content

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

CMD ["npm", "start"]
