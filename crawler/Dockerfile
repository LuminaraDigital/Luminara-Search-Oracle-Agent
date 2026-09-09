FROM node:20-bookworm-slim

WORKDIR /app

# Install system dependencies required for Chromium
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    fonts-liberation \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Browser binaries live in a shared, world-readable path so the unprivileged runtime user can use them.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json ./
RUN npm install --omit=dev

# Install Patchright Chromium binaries
RUN npx patchright install chromium || true
RUN chmod -R a+rX /ms-playwright 2>/dev/null || true

COPY server.mjs ssrf.mjs ./

# Run as the unprivileged `node` user (uid 1000). Chromium keeps --no-sandbox because user
# namespaces are usually unavailable in containers; the container itself is the sandbox.
RUN chown -R node:node /app
USER node

EXPOSE 3001
ENV PORT=3001
# Inside the container bind all interfaces; docker-compose publishes the port on 127.0.0.1 only.
ENV HOST=0.0.0.0
ENV NODE_ENV=production

CMD ["node", "server.mjs"]
