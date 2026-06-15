# Stölner BSC — Container-Image
FROM node:22.22-alpine

WORKDIR /app

# Abhängigkeiten zuerst (besseres Layer-Caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Anwendung
COPY . .

ENV NODE_ENV=production
# Render/Hoster setzen PORT selbst; lokal Standard 3000
EXPOSE 3000

CMD ["npm", "start"]
