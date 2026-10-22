FROM node:24-alpine
WORKDIR /app
COPY server ./server
COPY web ./web
USER node
ENV NODE_ENV=production PORT=8098 HOST=0.0.0.0 DATA_DIR=/data WEB_DIR=/app/web
CMD ["node", "server/server.js"]
