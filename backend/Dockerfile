FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY config ./config
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 8080
CMD ["node", "src/server.mjs"]
