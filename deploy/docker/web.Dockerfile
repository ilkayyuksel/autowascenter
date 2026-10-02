# Web app (TanStack Start SSR on Node). Build context: the repository root.
#
# Stage 1 installs and builds; stage 2 contains only the self-contained .output/ bundle, so
# the runtime image has no sources, no dev dependencies, no package manager state and no
# .env. The VITE_* build arguments are PUBLIC values (they are compiled into the browser
# bundle); never pass a secret here.

# Node 22.18.0: the version the repository is developed and tested on. Its built-in
# TypeScript type stripping is what runs the API, and Nitro's node-server output targets it.
FROM node:22.18.0-alpine AS build
WORKDIR /app

# Dependencies first: this layer is reused while only sources change.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Public build-time configuration (see deploy/.env.example).
# VITE_API_BASE_URL is intentionally EMPTY in the Docker stack: the browser then calls
# /api/... on the site's own origin and Caddy forwards it to the API container.
ARG VITE_API_BASE_URL=""
ARG VITE_AUTH0_DOMAIN=""
ARG VITE_AUTH0_CLIENT_ID=""
ARG VITE_AUTH0_AUDIENCE=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_AUTH0_DOMAIN=$VITE_AUTH0_DOMAIN \
    VITE_AUTH0_CLIENT_ID=$VITE_AUTH0_CLIENT_ID \
    VITE_AUTH0_AUDIENCE=$VITE_AUTH0_AUDIENCE

# Only what the build needs. packages/shared holds the Zod contracts the frontend imports.
COPY tsconfig.json vite.config.ts ./
COPY packages/shared ./packages/shared
COPY public ./public
COPY src ./src

RUN npm run build

# ---------------------------------------------------------------------------------------
FROM node:22.18.0-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# .output is standalone: it needs Node and nothing else from the repository.
COPY --from=build --chown=node:node /app/.output ./.output

# Non-root: the image's unprivileged `node` user (uid 1000).
USER node
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
