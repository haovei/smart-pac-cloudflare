FROM node:20-slim
LABEL maintainer="haovei@gmail.com"

WORKDIR /app

# Install pnpm and project dependencies
RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Wrangler's local development server listens on 8787 by default
EXPOSE 8787/tcp

CMD ["pnpm", "dev"]
