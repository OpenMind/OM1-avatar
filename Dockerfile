FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci

COPY . .

RUN npm run build

EXPOSE 4173

RUN echo '#!/bin/sh\n\
echo "window.ENV = {" > /app/dist/env.js\n\
env | grep "^VITE_" | while IFS="=" read -r key value; do\n\
  echo "  $key: \"$value\"," >> /app/dist/env.js\n\
done\n\
echo "};" >> /app/dist/env.js\n\
exec npm run preview -- --host 0.0.0.0 --port 4173' > /app/start.sh && chmod +x /app/start.sh

CMD ["/app/start.sh"]
