FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci

COPY . .

RUN npm run build

EXPOSE 4173

COPY docker-start.sh /app/start.sh
RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]
