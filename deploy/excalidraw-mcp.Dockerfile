# Build with the repository root as context. Native geometry imports and their
# workspace dependencies must match the editor revision used by this checkout.
FROM node:22-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable
COPY . .
RUN yarn install --frozen-lockfile --network-timeout 600000
WORKDIR /workspace/integrations/excalidraw-mcp
RUN pnpm install --frozen-lockfile && pnpm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
COPY --from=build /workspace/integrations/excalidraw-mcp/dist ./dist
EXPOSE 3001
CMD ["node", "dist/index.js"]
