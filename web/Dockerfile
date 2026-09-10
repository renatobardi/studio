FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
# Vite auto-loads web/.env (gitignored, see scripts/ops/create-firebase-project.sh)
# for the VITE_FIREBASE_* client config — not passed as ARG/ENV so it never
# ends up baked into an image layer.
RUN bun run build

# Non-root nginx (plain nginx:alpine runs as root) — listens on 8080, see Caddyfile.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
