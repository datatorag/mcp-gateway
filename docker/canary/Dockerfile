# The canary image (SCRUM-394). Build context is this directory.
FROM node:20-alpine
WORKDIR /app
COPY server.mjs ./
# The commit travels INTO the image, as the gateway's does.
ARG CANARY_SHA=""
ENV CANARY_SHA=$CANARY_SHA
ENV NODE_ENV=production
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
