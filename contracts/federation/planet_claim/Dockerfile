# BUILDER

FROM node:18-alpine AS claim-builder
RUN apk add --no-cache --virtual build-dependencies curl git

COPY --chown=node . /var/scripts/alienworlds

USER node
WORKDIR /var/scripts/alienworlds

RUN npm install --omit=dev

# PRODUCTION

FROM node:18-alpine AS claim
LABEL org.opencontainers.image.vendor='Dacoco GMBH' \
      org.opencontainers.image.description='Planet claim and Land inflation scripts'

COPY --chown=node --from=claim-builder /var/scripts/alienworlds /var/scripts/alienworlds
USER node
WORKDIR /var/scripts/alienworlds

CMD [ "node", "--version" ]