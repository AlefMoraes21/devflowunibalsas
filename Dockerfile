FROM node:18-alpine

WORKDIR /app

# Como tudo está na raiz, copiamos diretamente
COPY package*.json ./

RUN npm install

COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
