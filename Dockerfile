FROM node:18-alpine

WORKDIR /app

# Copia as dependências da pasta api
COPY api/package*.json ./

RUN npm install

# Copia todo o código da pasta api
COPY api/ .

ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
