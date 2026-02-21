FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server.js ./

# Run as non-root
USER 1000

HEALTHCHECK --interval=30s --timeout=3s CMD node -e "require('http').get('http://localhost:3001/health',(r)=>process.exit(r.statusCode===200?0:1))"

EXPOSE 3001
CMD ["node", "server.js"]
