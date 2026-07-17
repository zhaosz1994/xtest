FROM node:18-alpine

LABEL maintainer="xtest-team"
LABEL description="xTest - Professional Test Management Platform"

WORKDIR /app

RUN apk add --no-cache tzdata

COPY package*.json ./

RUN npm ci --only=production

COPY . .

RUN mkdir -p /app/logs /app/uploads

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

CMD ["node", "server.js"]
