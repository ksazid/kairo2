FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN npm ci --no-audit --no-fund
RUN npm run build --workspace @kairo/api
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/migrations ./apps/api/migrations
COPY --from=build /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=build /app/scripts/migrate-range.mjs ./scripts/migrate-range.mjs
COPY --from=build /app/scripts/start-api.mjs ./scripts/start-api.mjs
WORKDIR /app/apps/api
USER node
EXPOSE 4000
CMD ["node", "../../scripts/start-api.mjs"]
