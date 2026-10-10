# AMV's cloud computer: the AMV bridge in --cloud mode, in a folder of its own.
# Built by `wrangler deploy` from this folder (see wrangler.toml and GO-LIVE.md).
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends git python3 python3-pip python3-venv ca-certificates curl build-essential \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --shell /bin/bash amv \
 && mkdir -p /work && chown amv:amv /work
COPY amv-bridge.mjs /app/amv-bridge.mjs
USER amv
WORKDIR /work
EXPOSE 8080
CMD ["node", "/app/amv-bridge.mjs", "/work", "--cloud"]
