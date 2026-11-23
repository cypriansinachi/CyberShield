# syntax=docker/dockerfile:1
# CyberShield: Nexora Incident Reporting & Response

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The display timezone is compiled into the UI at build time.
ARG NEXT_PUBLIC_APP_TIMEZONE="Africa/Lagos"
ENV NEXT_PUBLIC_APP_TIMEZONE=$NEXT_PUBLIC_APP_TIMEZONE
RUN npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# Run as an unprivileged user; only the data volume is writable.
# (Set TURSO_DATABASE_URL / TURSO_AUTH_TOKEN to use a hosted database instead.)
RUN useradd --system --uid 1001 --home /app cirp \
 && mkdir -p /app/data \
 && chown cirp /app/data
COPY --from=build /app/package.json /app/package-lock.json /app/next.config.ts /app/tsconfig.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/public ./public
COPY --from=build /app/.next ./.next
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
USER cirp
EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/next", "start"]
