FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates curl unzip && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY .npmrc ./

# Copy package manifests
COPY packages/config/package.json packages/config/
COPY packages/types/package.json packages/types/
COPY packages/db/package.json packages/db/
COPY packages/auth/package.json packages/auth/
COPY apps/gateway/package.json apps/gateway/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/config/ packages/config/
COPY packages/types/ packages/types/
COPY packages/db/ packages/db/
COPY packages/auth/ packages/auth/
COPY apps/gateway/ apps/gateway/

# Build workspace packages, then Next.js + custom server
ENV DATABASE_URL=postgresql://placeholder:placeholder@placeholder:5432/placeholder

# Build-time: Next.js inlines NEXT_PUBLIC_* into the client bundle during `next build`.
# Pass the value via `docker build --build-arg NEXT_PUBLIC_POSTHOG_KEY=...` or docker-compose build.args.
ARG NEXT_PUBLIC_POSTHOG_KEY=""
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL=""
ENV NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL=$NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL

RUN pnpm run build --filter=@datatorag-mcp/gateway

WORKDIR /app/apps/gateway
EXPOSE 80
CMD ["node", "dist/server.js"]
