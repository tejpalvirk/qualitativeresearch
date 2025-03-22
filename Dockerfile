FROM node:22.12-alpine AS builder

COPY qualitativeresearch /app
COPY tsconfig.json /tsconfig.json

WORKDIR /app

RUN --mount=type=cache,target=/root/.npm npm install

RUN --mount=type=cache,target=/root/.npm-production npm ci --ignore-scripts --omit-dev

FROM node:22-alpine AS release

COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/package-lock.json /app/package-lock.json
COPY --from=builder /app/memory.json /app/memory.json
COPY --from=builder /app/qualitative_research_memory.json /app/qualitative_research_memory.json

ENV NODE_ENV=production
ENV MEMORY_FILE_PATH=/app/memory.json

WORKDIR /app

RUN npm ci --ignore-scripts --omit-dev

ENTRYPOINT ["node", "dist/qualitativeresearch_index.js"] 