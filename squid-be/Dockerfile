# Stage 1 - build
FROM node:23-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2 - runtime
FROM node:23-alpine AS runner
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app .
ENV NODE_ENV=production
EXPOSE 3333
CMD ["npm","run", "start"]