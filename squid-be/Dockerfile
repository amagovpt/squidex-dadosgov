# Stage 1 - build
FROM node:23-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2 - runtime
FROM node:23-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Install production dependencies only.
COPY package*.json ./
RUN npm ci --omit=dev
# Copy just the compiled output so dev dependencies and sources stay out of the
# runtime image.
COPY --from=builder /app/build ./build
# Run as the unprivileged built-in node user.
USER node
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3333/api/healthcheck || exit 1
CMD ["node", "build/server.js"]
