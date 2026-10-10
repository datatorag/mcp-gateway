# The gateway image. Build context is the repository root.
#
# Three stages:
#   base     the pinned Node image, the tools the running gateway's operators
#            use inside the container, pnpm, and the workspace's manifests.
#   build    every dependency and the whole source; builds the workspace
#            packages, the Next.js app and the custom server. Not shipped.
#   runtime  what ships: production dependencies only, and the build's
#            output. No source, no dev dependencies, no build cache.
#
# The layout of the runtime stage is the one the single-stage image had
# (/app/apps/gateway, the workspace packages beside it), so the compose file,
# the plugin volume's mount and every documented `docker exec` are unchanged.
#
# The base is named by digest, so one commit always builds on one base and a
# moved tag cannot change what ships. The tag before the @ is for the reader;
# only the digest is used. To move it: look up the new digest
# (`docker buildx imagetools inspect node:<line>-slim`), change it here, and
# let a pull request build it.
FROM node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS base
# Runtime tools, not build tools: plugins are updated in place in the running
# container (git, pnpm), and a plugin's own build fetches a binary (curl,
# unzip). See the deploy skill.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates curl unzip && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Workspace root files and package manifests: all an install needs.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY .npmrc ./
COPY packages/config/package.json packages/config/
COPY packages/types/package.json packages/types/
COPY packages/db/package.json packages/db/
COPY packages/auth/package.json packages/auth/
COPY apps/gateway/package.json apps/gateway/
# The plugins are workspace members, so the frozen install needs their
# manifests to match the lockfile.
COPY plugins/gws-mcp/package.json plugins/gws-mcp/
COPY plugins/atlassian-mcp/package.json plugins/atlassian-mcp/


FROM base AS build
RUN pnpm install --frozen-lockfile

COPY packages/config/ packages/config/
COPY packages/types/ packages/types/
COPY packages/db/ packages/db/
COPY packages/auth/ packages/auth/
COPY apps/gateway/ apps/gateway/
COPY plugins/ plugins/

# The config schema requires a DATABASE_URL to load. The build never connects.
ENV DATABASE_URL=postgresql://placeholder:placeholder@placeholder:5432/placeholder

# Build-time: Next.js inlines NEXT_PUBLIC_* into the client bundle during `next build`.
# Pass the value via `docker build --build-arg NEXT_PUBLIC_POSTHOG_KEY=...` or docker-compose build.args.
ARG NEXT_PUBLIC_POSTHOG_KEY=""
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL=""
ENV NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL=$NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL
ARG NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_CONVERSION_LABEL=""
ENV NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_CONVERSION_LABEL=$NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_CONVERSION_LABEL

# The build cache is for the next build on the same machine. It is not part of
# what runs.
RUN pnpm run build --filter=@datatorag-mcp/gateway && rm -rf apps/gateway/.next/cache
# Each plugin is compiled here (tsc into server/), from the same commit as
# the gateway. Nothing is compiled in the running container.
RUN pnpm --filter @datatorag-mcp/gws-mcp run build \
 && pnpm --filter @datatorag-mcp/atlassian-mcp run build


FROM base AS runtime
# Production dependencies only. The workspace packages are linked into
# node_modules from /app/packages, where their built output is copied below.
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/packages/config/dist packages/config/dist
COPY --from=build /app/packages/types/dist packages/types/dist
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/packages/auth/dist packages/auth/dist
COPY --from=build /app/apps/gateway/.next apps/gateway/.next
COPY --from=build /app/apps/gateway/dist apps/gateway/dist
# Read from disk by the running server: the Next config, static files, and the
# blog, changelog and docs sources.
COPY apps/gateway/next.config.ts apps/gateway/
COPY apps/gateway/public apps/gateway/public
COPY apps/gateway/content apps/gateway/content

# The plugins, at /app/plugins/<slug>: the compiled server, and from the tree
# the manifest the manager reads for the entry point (already copied above),
# the plugin manifest and the README. No source, no git metadata, no dev
# dependencies; the production install above already covers their packages.
#
# NOT at the path the plugins volume is mounted on: a mounted volume hides
# whatever the image has there.
COPY --from=build /app/plugins/gws-mcp/server plugins/gws-mcp/server
COPY --from=build /app/plugins/atlassian-mcp/server plugins/atlassian-mcp/server
COPY plugins/gws-mcp/datatorag.json plugins/gws-mcp/README.md plugins/gws-mcp/
COPY plugins/atlassian-mcp/datatorag.json plugins/atlassian-mcp/README.md plugins/atlassian-mcp/
# A client secret file is written beside the compiled code only by the desktop
# bundle's own build script, and git ignores it. It must never be in an image.
RUN if find /app/plugins -name oauth.json -not -path '*/node_modules/*' | grep -q .; then \
      echo "oauth.json found under /app/plugins" >&2; exit 1; fi
# The cutover (SCRUM-390): the gateway starts the plugins above, and no
# longer the copies in the plugins volume. This line is the whole switch. It
# is here and nowhere else (not the compose file, not the parameter store,
# not a row), so an image from before this line loads from the volume again
# and rolling the image back is the whole undo.
ENV DATATORAG_PLUGINS_DIR=/app/plugins

# The same build-time values, present at run time as they were before: server
# code reads them from the environment too.
ARG NEXT_PUBLIC_POSTHOG_KEY=""
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL=""
ENV NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL=$NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL
ARG NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_CONVERSION_LABEL=""
ENV NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_CONVERSION_LABEL=$NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_CONVERSION_LABEL
# The gateway's own commit, baked in at build time (SCRUM-303). It cannot be
# rendered into .env like a secret: .env is written on the host and the sha
# has to travel INTO the image, so the run that records it knows which build
# answered. Empty here is honest, and a run stores null rather than a guess.
# It comes last, so a new commit rebuilds only this line of the runtime stage.
ARG GATEWAY_SHA=""
ENV GATEWAY_SHA=$GATEWAY_SHA

WORKDIR /app/apps/gateway
EXPOSE 80
CMD ["node", "dist/server.js"]
