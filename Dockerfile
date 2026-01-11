FROM node:20-slim
LABEL org.opencontainers.image.title="gapis-mock" \
 org.opencontainers.image.description="Mock server for all Google APIs for local development and testing" \
 org.opencontainers.image.version="1.0.1" \
 org.opencontainers.image.source="https://github.com/cloud26apps/gapis-mock"
WORKDIR /app
COPY simulator.js routerManager.js loadData.js data.zip mockGenerator.js proxy.js package.json ./
RUN npm install --omit=dev
EXPOSE 3333 3344
CMD ["node", "simulator.js"]