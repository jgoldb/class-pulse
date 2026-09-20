# Class Pulse runs as a single Node process: the Fastify API, the in-process job queue and
# scheduler, and the built SPA served from the same origin. See docs/08 — one API instance is
# the deployment shape, so there is no separate worker image.
#
# The whole repo runs from TypeScript source via tsx: every workspace package exports
# ./src/index.ts directly (see packages/*/package.json "exports"), and the base tsconfig sets
# noEmit. Compiling to JS would mean adding build output and export maps to four packages, so
# the runtime keeps tsx and the image keeps dev dependencies.

FROM node:22-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# ---- deps: install once against the lockfile, cached until a manifest changes ----
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json      apps/api/package.json
COPY apps/web/package.json      apps/web/package.json
COPY packages/ai/package.json   packages/ai/package.json
COPY packages/domain/package.json   packages/domain/package.json
COPY packages/patterns/package.json packages/patterns/package.json
COPY packages/policy/package.json   packages/policy/package.json
# --include=dev: tsx runs the server, and vite builds the client.
RUN npm ci --include=dev

# ---- build: produce apps/web/dist ----
FROM deps AS build
COPY . .
# Vite inlines this at build time, so it cannot be a runtime secret. It is the Clerk
# *publishable* key, which is safe in client code by design.
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
RUN test -n "$VITE_CLERK_PUBLISHABLE_KEY" || (echo "VITE_CLERK_PUBLISHABLE_KEY build arg is required" && exit 1)
# apps/web/vite.config.ts sets envDir to the repo root, so write the key where Vite looks for
# it rather than relying on process.env precedence. This file stays in the build stage.
RUN printf 'VITE_CLERK_PUBLISHABLE_KEY=%s\n' "$VITE_CLERK_PUBLISHABLE_KEY" > .env
RUN npm run build --workspace apps/web

# ---- runtime ----
FROM base AS runtime
COPY --from=deps  /app/node_modules      ./node_modules
COPY --from=build /app/apps/web/dist     ./apps/web/dist
COPY apps/api      ./apps/api
COPY packages      ./packages
COPY package.json  ./package.json

# Drop privileges: nothing here needs root, and the image carries a package manager.
USER node

EXPOSE 3001
ENV PORT=3001
# Migrations run at boot (apps/api/src/db/client.ts), so there is no release-phase step.
CMD ["npm", "run", "start", "--workspace", "apps/api"]
