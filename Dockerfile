FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci

COPY . .

RUN npm run build

EXPOSE 4173

COPY <<EOF /app/start.sh
#!/bin/sh
echo "window.ENV = {" > /app/dist/env.js
env | grep "^VITE_" | while IFS="=" read -r key value; do
  echo "  \$key: \"\$value\"," >> /app/dist/env.js
done
echo "};" >> /app/dist/env.js
exec npm run preview -- --host 0.0.0.0 --port 4173
EOF

RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]
