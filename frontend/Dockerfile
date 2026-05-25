# syntax=docker/dockerfile:1.4
FROM node:20-alpine AS build

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm install --no-audit --no-fund --include=dev

COPY . .
RUN npm run build

# ----------------------------------------
FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
