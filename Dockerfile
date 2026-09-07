# Static self-host image (no Worker features: users bring their own API keys in Settings).
# For the full stack (provider proxy, Telegram bot, Stars payments) deploy the Cloudflare Worker instead.
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
