FROM node:22-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./

# Run as non-root
USER 1000

EXPOSE 3001
CMD ["node", "server.js"]
