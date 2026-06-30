# Antigravity Pro — production image
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# install deps first (better layer caching)
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# app source
COPY . .

EXPOSE 3000

# liveness probe (Node 20 has global fetch)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
