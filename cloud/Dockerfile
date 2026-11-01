# AMV's cloud computer: the AMV bridge in --cloud mode, in a folder of its own.
# Built by `wrangler deploy` from this folder (see wrangler.toml and GO-LIVE.md).
FROM node:22-bookworm-slim
# Upgraded at build, not only installed: the base image's own packages carry
# fixes released after it was tagged, and this machine runs people's code.
# npm too: the copy bundled with the base image carries its own dependencies
# (brace-expansion, sigstore, pacote...), and the first scan found fixed holes
# in them. .github/workflows/image-scan.yml fails on any fixable HIGH or CRITICAL.
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && apt-get install -y --no-install-recommends git python3 python3-pip python3-venv ca-certificates curl build-essential \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g npm@11 \
 && npm cache clean --force \
 && useradd --create-home --shell /bin/bash amv \
 && mkdir -p /work && chown amv:amv /work
COPY amv-bridge.mjs /app/amv-bridge.mjs
USER amv
WORKDIR /work
EXPOSE 8080
CMD ["node", "/app/amv-bridge.mjs", "/work", "--cloud"]
