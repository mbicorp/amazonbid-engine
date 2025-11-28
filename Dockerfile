# ビルド用ステージ
FROM node:22-slim AS builder

WORKDIR /usr/src/app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY *.ts ./
COPY src ./src

RUN npm run build

# 実行ステージ
FROM node:22-slim AS runner

WORKDIR /usr/src/app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /usr/src/app/dist ./dist

ENV PORT=8080
CMD ["node", "dist/src/server.js"]
