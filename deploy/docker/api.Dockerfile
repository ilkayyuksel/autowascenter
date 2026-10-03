# Fastify API. Build context: the repository root, because apps/api depends on
# packages/shared through `file:../../packages/shared`; that relative layout is kept inside
# the image so the symlink in node_modules resolves.
#
# The API runs its TypeScript sources directly on Node's built-in type stripping
# (process.features.typescript === "strip" since Node 22.18). That is the same `node`
# binary as in production, not a development-only runner: no transpiler, no loader and no
# extra dependency. The repository is built for it (`erasableSyntaxOnly`, explicit `.ts`
# import specifiers) and `tsc --noEmit` type-checks every build. See deploy/README.md.

FROM node:22.18.0-alpine AS deps
WORKDIR /repo

# Production dependencies only (drizzle-kit, PGlite and TypeScript are dev dependencies).
#
# packages/shared gets its OWN node_modules. `@autowascenter/shared` is a `file:` dependency,
# so npm links it and Node resolves its imports from the link's REAL path
# (/repo/packages/shared/...), which never reaches /repo/apps/api/node_modules. Without this,
# `import { z } from "zod"` inside packages/shared fails with ERR_MODULE_NOT_FOUND at startup.
COPY packages/shared/package.json packages/shared/package-lock.json ./packages/shared/
COPY packages/shared/src ./packages/shared/src
COPY apps/api/package.json apps/api/package-lock.json ./apps/api/
RUN cd packages/shared && npm ci --omit=dev --no-audit --no-fund \
    && cd ../../apps/api && npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# ---------------------------------------------------------------------------------------
FROM node:22.18.0-alpine AS runtime
WORKDIR /repo/apps/api

# npm_config_cache points at /tmp so `npm run ...` also works with a read-only root
# filesystem (the container gets a tmpfs on /tmp).
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    UPLOAD_DIR=/app/uploads \
    npm_config_cache=/tmp/.npm

COPY --from=deps --chown=node:node /repo /repo
# Sources, migrations and the type configuration. No tests, no .env, no PGlite fixtures.
COPY --chown=node:node apps/api/package.json ./package.json
COPY --chown=node:node apps/api/tsconfig.json ./tsconfig.json
COPY --chown=node:node apps/api/src ./src
COPY --chown=node:node apps/api/drizzle ./drizzle

# Upload root: created with the right ownership so a fresh named volume mounted here is
# writable by the non-root user (Docker copies the directory's ownership into the volume).
RUN mkdir -p /app/uploads && chown -R node:node /app

USER node
EXPOSE 3001

CMD ["node", "src/server.ts"]
