# MGEO PDF – imagem para EasyPanel (ou qualquer Docker)
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 3000
# O teste de saúde usa a mesma porta do app (a variável PORT), seja 3000, 80 ou outra definida no EasyPanel
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# O volume do EasyPanel chega como root: ajusta a permissão de /data e roda o app como usuário comum
CMD ["sh", "-c", "mkdir -p /data && chown -R node:node /data && exec setpriv --reuid=node --regid=node --init-groups node server/server.js"]
