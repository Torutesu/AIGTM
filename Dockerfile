# Monorepo image: web app + worker + migrate/seed jobs share one image.
#   docker build -t aigtm .
#   docker run -e DATABASE_URL=... aigtm            # web
#   docker run -e DATABASE_URL=... aigtm worker     # trigger worker
#   docker run -e DATABASE_URL=... aigtm migrate    # migrations + RLS only
#   docker run -e DATABASE_URL=... aigtm seed       # migrate + demo seed
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# Dependency layer — cache busts only when manifests change.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/agent-runtime/package.json packages/agent-runtime/
COPY packages/auth/package.json packages/auth/
COPY packages/connectors/package.json packages/connectors/
COPY packages/db/package.json packages/db/
COPY packages/specs/package.json packages/specs/
RUN pnpm install --frozen-lockfile

FROM base AS run
COPY --from=deps /app ./
COPY . .
RUN pnpm --filter @aigtm/web build
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["web"]
