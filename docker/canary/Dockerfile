# The canary image (SCRUM-394). Build context is this directory.
# The base is named by digest, so the same commit always builds on the same
# base and a moved tag cannot change what ships. The tag before the @ is for
# the reader; only the digest is used. To move it: look up the new digest
# (`docker buildx imagetools inspect node:<line>-alpine`), change both, and
# let a pull request build it.
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
WORKDIR /app
COPY server.mjs ./
# The commit travels INTO the image, as the gateway's does.
ARG CANARY_SHA=""
ENV CANARY_SHA=$CANARY_SHA
ENV NODE_ENV=production
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
