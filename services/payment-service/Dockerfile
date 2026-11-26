# Debian-based (glibc) image on purpose: the bcrypt native module ships prebuilt
# binaries for it, so no compiler is needed in the image.
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
# Dependencies first: this layer is cached until package.json changes.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
USER node
EXPOSE 3004
CMD ["node", "src/server.js"]
