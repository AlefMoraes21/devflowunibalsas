FROM node:18-alpine

WORKDIR /app

# Copia os ficheiros de dependências diretamente
COPY package*.json ./

RUN npm install

# Copia o resto do código da pasta
COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
