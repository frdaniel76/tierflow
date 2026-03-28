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
# Install optional ML classifier dependency for built-in smart routing.
# Without this, TierFlow falls back to the rule-based keyword scorer.
RUN npm install --omit=dev @huggingface/transformers 2>/dev/null; exit 0

COPY --from=builder /app/dist/ ./dist/
COPY src/ml/training-data.json ./src/ml/training-data.json

ENV TIERFLOW_HOST=0.0.0.0
ENV TIERFLOW_PORT=18800

EXPOSE 18800

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:18800/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
