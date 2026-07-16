# DevFlow UniBalsas no cPanel

Aplicação Node.js para o endpoint criptografado do WhatsApp Flow.

## Requisitos

- cPanel com **Application Manager** ou **Setup Node.js App** habilitado.
- Node.js 18 ou superior (recomendado: Node.js 20 ou 22).
- Domínio ou subdomínio com HTTPS ativo.

## Publicação

1. Envie este repositório para uma pasta fora de `public_html`, por exemplo `devflowunibalsas`.
2. No cPanel, abra **Application Manager** (ou **Setup Node.js App**) e crie uma aplicação Node.js.
3. Selecione **Production**, a raiz `devflowunibalsas` e o arquivo de inicialização `app.js`.
4. Associe a aplicação ao domínio/subdomínio e à URI desejada.
5. Em **Environment Variables**, configure `RBS_TOKEN` e uma das opções de chave. A aplicação não lê arquivo `.env`:
   - `FLOW_PRIVATE_KEY`: chave PEM (`PRIVATE KEY` ou `RSA PRIVATE KEY`) inteira em uma linha, usando `\n` no lugar das quebras de linha.
   - `FLOW_PRIVATE_KEY_BASE64`: alternativa recomendada se o painel truncar a chave PEM.
   - Se o base64 também for truncado, divida-o sequencialmente em
     `FLOW_PRIVATE_KEY_BASE64_1`, `FLOW_PRIVATE_KEY_BASE64_2` e assim por
     diante. A aplicação junta as partes automaticamente.
6. Faça o deploy e clique em **Restart** sempre que alterar uma variável. Não é necessário instalar pacotes npm: a aplicação usa apenas módulos nativos do Node.js.
7. Teste `https://SEU_DOMINIO/api/flow` (ou a URL montada pelo cPanel). A resposta esperada é JSON com `"status":"ok"`.
8. Configure essa URL HTTPS como endpoint do WhatsApp Flow.

Nunca envie o token da Rubeus ou a chave privada ao Git. Para aplicar atualizações no Passenger, reinicie pelo painel ou crie/atualize `tmp/restart.txt` no servidor.

Para gerar o valor base64 sem quebras de linha:

```bash
base64 -w 0 private_key.pem
```

No macOS:

```bash
base64 < private_key.pem | tr -d '\n'
```

Depois do restart, abra `https://SEU_DOMINIO/api/flow`. O campo
`key_fingerprint` deve conter 16 caracteres hexadecimais. Se ele mostrar uma
mensagem de erro, confira os logs da aplicação no cPanel.

## Teste local

```bash
npm run check
RBS_TOKEN=token FLOW_PRIVATE_KEY_BASE64_1=parte1 FLOW_PRIVATE_KEY_BASE64_2=parte2 npm start
curl http://localhost:3000/api/flow
```
