FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY config ./config
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATA_FILE=/app/data/state.json
RUN mkdir -p /app/data && chown node:node /app/data
EXPOSE 8080
USER node
CMD ["node","src/server.mjs"]
