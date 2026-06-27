FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY src/ src/
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/public ./public
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js .
EXPOSE 3000
CMD ["node", "server.js"]
