# ==============================================================================
# RouteGen AI - Frontend Dockerfile
# ==============================================================================

# Build Stage
FROM node:20-alpine AS build

WORKDIR /app

# Install dependencies first for better caching
COPY package.json package-lock.json ./
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

# Production Stage (Nginx)
FROM nginx:alpine

# Copy built assets from the build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Replace default nginx config if needed (we'll stick to default for now, but ensure it handles SPA routing)
RUN echo "server { \
    listen 80; \
    location / { \
        root /usr/share/nginx/html; \
        index index.html index.htm; \
        try_files \$uri \$uri/ /index.html; \
    } \
}" > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
