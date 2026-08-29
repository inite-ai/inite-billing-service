# Build stage
FROM node:26-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
COPY tsconfig*.json ./
COPY nest-cli.json ./
COPY prisma ./prisma

RUN npm ci

COPY src ./src
RUN npm run build

# Fail the build here rather than at container start: a stray .ts outside src
# shifts tsc's rootDir and moves the entrypoint to dist/src/main.js, which
# otherwise only surfaces in production as a MODULE_NOT_FOUND crash loop.
RUN test -f dist/main.js || (echo "Build error: dist/main.js missing — check tsconfig include/rootDir" && ls -R dist | head -50 && exit 1)

# Production stage
FROM node:26-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
COPY --from=builder /app/prisma ./prisma

RUN npm ci --only=production && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY scripts/migrate.sh ./scripts/migrate.sh

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

RUN chown -R nestjs:nodejs /app

USER nestjs

EXPOSE 3000

CMD ["sh", "-c", "sh scripts/migrate.sh && node dist/main"]
