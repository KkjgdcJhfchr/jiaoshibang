FROM node:22-alpine AS frontend-builder

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install --global pnpm@11.9.0 --no-audit --no-fund \
    && pnpm install --frozen-lockfile

COPY index.html admin.html vite.config.js ./
COPY server/admin-entry.mjs ./server/admin-entry.mjs
COPY src ./src
COPY public ./public
RUN pnpm run build
RUN pnpm prune --prod

FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    STATIC_DIR=dist \
    DATA_DIR=/app/data

WORKDIR /app
RUN addgroup -S app && adduser -S -G app app

COPY --from=frontend-builder --chown=app:app /app/dist ./dist
COPY --from=frontend-builder --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app server ./server
COPY --chown=app:app shared ./shared

RUN mkdir -p /app/data && chown -R app:app /app/data

USER app
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
