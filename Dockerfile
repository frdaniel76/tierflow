# Stage 1: Build
FROM node:22-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY src/ ./src/
COPY tsconfig.json tsup.config.ts ./
RUN npm run build

# Stage 2: Runtime (no devDependencies, no source)
FROM node:22-slim
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev 2>/dev/null; exit 0
# Note: freerouter has zero runtime deps, so npm ci --omit=dev installs nothing.
# The dist/ folder is fully self-contained.

COPY --from=builder /app/dist/ ./dist/

ENV CLAWROUTER_HOST=0.0.0.0
ENV CLAWROUTER_PORT=18800

EXPOSE 18800

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:18800/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
