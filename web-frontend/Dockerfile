# Stage 1: Build
FROM node:22-slim AS build

WORKDIR /app

COPY package.json ./
RUN npm install

COPY index.html vite.config.js ./
COPY public/ ./public/
COPY src/ ./src/

RUN npx vite build

# Stage 2: Serve with nginx
FROM nginx:alpine

# Copy built files
COPY --from=build /app/dist /usr/share/nginx/html

# SPA fallback: serve index.html for all routes (e.g. /share/:token)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
