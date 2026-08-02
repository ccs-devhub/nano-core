# The fleet image: one image carries the module superset; each
# instance's nano.config.json (on its volume) selects the subset.
# Image tag = git tag. Node version pinned to .nvmrc.

FROM node:22.12.0-slim AS build
WORKDIR /app

# The framework's own lockfile installs WITH lifecycle scripts:
# better-sqlite3 fetches its prebuilt binding in one. The
# --ignore-scripts law applies to foreign store modules only.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json tsconfig.modules.json ./
COPY src ./src
COPY modules ./modules

# The mcp module vendors its own deps from its own lockfile; the
# modules build type-checks against them, so install first.
# (cd form: npm 10 rejects 'npm ci --prefix'.)
RUN cd modules/mcp && npm ci --omit=dev
RUN npm run build \
 && npm prune --omit=dev

FROM node:22.12.0-slim
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-modules ./modules
COPY --from=build /app/modules/mcp/package.json \
  ./modules/mcp/package.json
COPY --from=build /app/modules/mcp/node_modules \
  ./modules/mcp/node_modules

# Modules resolve the public barrel exactly as an npm peer would:
# package main points at dist/lib/index.js, and Node ESM realpaths
# the link so core and modules share one module instance.
RUN mkdir -p node_modules/@ccs-devhub \
 && ln -s ../.. node_modules/@ccs-devhub/nano-core

# Non-root; the instance volume (cwd) is the only writable path.
USER 10001

STOPSIGNAL SIGTERM

# Exec form: npm-as-PID1 skips SIGTERM and loses the final flush.
CMD ["node", "/app/dist/index.js"]
