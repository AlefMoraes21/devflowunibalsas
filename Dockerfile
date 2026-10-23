# Usa a versão oficial do Node.js
FROM node:18-alpine

# Cria e define o diretório de trabalho dentro do contentor
WORKDIR /app

# Copia os ficheiros de dependências
COPY package*.json ./

# Instala as dependências da aplicação
RUN npm install

# Copia o resto do código do projeto
COPY . .

# Expõe a porta que o Cloud Run espera (geralmente 8080)
ENV PORT=8080
EXPOSE 8080

# Comando para iniciar a aplicação
CMD ["npm", "start"]
