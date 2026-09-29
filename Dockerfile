# Game backend for Bloxity Legion hosting: REST + Colyseus lobbies on one port.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

# Legion injects PORT (2567); this is only the default.
ENV PORT=2567
EXPOSE 2567

# Run as the image's built-in non-root user.
USER node
CMD ["node", "src/server.js"]
