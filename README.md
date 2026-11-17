# DevFlow UniBalsas

Endpoint do **WhatsApp Flow** dos processos seletivos 2027/1 da UniBalsas: inscrição (Vestibular, Transferência, Portador de Diploma e Nota do ENEM), redação, documentos de inscrição, matrícula, contrato e pagamento, sem sair do WhatsApp e seguindo o site do vestibular.

- Versão atual: **2.14.0** (`GET /api/flow` responde `unibalsas-cloudrun-jornada-2.14.0`; histórico em `LEIA-ME.md`)
- Flow da WABA (único): `flows/etapa1-vestibular.json` (JSON 7.3, Data API 3.0), gerado por `node flows/gerar-etapa1.mjs`
- Execução: Node.js 22+, sem dependências externas
- Hospedagem: Google Cloud Run (`southamerica-east1`), Firestore e Cloud Tasks

## Como funciona

```
WhatsApp Flow ──(criptografado)──▶ POST /api/flow ──▶ grava no Firestore e responde na hora
                                                         │
                                       Cloud Tasks ──▶ POST /internal/flow-worker ──▶ Rubeus / portal do candidato
                                                         │                         └─▶ módulo de avaliação (redação)
                                                         └─▶ vigias (correção, análise, contrato, pagamento) ──▶ avisos pelo Blip
```

A Meta dá 10 s para cada resposta. Por isso o Flow só grava e responde; o envio ao Rubeus é feito pelo worker, com
calma e conferência, igual ao que o candidato faria no site. Ao vivo ficam só o login (CPF + data de nascimento) e o CEP.

O estado de cada tela vai selado (AES-GCM) no campo `estado`, nunca vindo do cliente. Telas que não são do Flow atual
(`INSC_*`, `MATR_*`, `CONTR_*`) recebem uma tela de fim com orientação.

## Jornada

| Processo | Rubeus / IDPS | Etapa 1 no Flow |
|---|---|---|
| Vestibular Online | 20383 / 223 | dados → curso → "Estamos quase lá" → Obrigado → Portal → prova → redação |
| Transferência | 20385 / 225 | dados → curso → "Estamos quase lá" → Obrigado → Portal → documentos (28\*, 29, 27) → status |
| Portador de Diploma | 20384 / 224 | dados → curso → "Estamos quase lá" → Obrigado → Portal → documentos (10\*, 17, 26) → status |
| Nota do ENEM | 20386 / 226 | dados → curso e notas → "Estamos quase lá" → Obrigado → Portal → boletim (25\*) → status |

Quem já se inscreveu entra por **Já sou inscrito (LOGIN)** e vê a lista de etapas do portal, com o botão da etapa liberada
(documentos de inscrição, responsável financeiro, pré-matrícula, documentos de matrícula, contrato, pagamento).

## Estrutura

```
server.js                 servidor HTTP (/api/flow, /internal/flow-worker, /contrato/<token>, /healthz)
api/flow.js               entrada do Flow, criptografia, worker e o motor de gravação no Rubeus
api/etapa1-fila.js        telas INSC_* (inscrição, redação, documentos de inscrição) e worker da etapa 1
api/etapa2-matricula.js   LOGIN, status do portal, matrícula, contrato, pagamento e vigias
api/portal-site.js        caminho do site (portal do candidato): status, documentos, contrato, Pix
api/matricula.js          login no Rubeus e leitura das etapas do portal
api/blip.js               avisos pelo Blip (templates aprovados)
api/cloud-store.js        Firestore, Cloud Tasks e cifragem
api/processes.js          política e documentos de inscrição por processo
api/avaliacao.js, prova-route.js, proof-binding.js, prompt-text.js   prova e redação
api/documentos.js         mídia do DocumentPicker
api/enem.js, diagnostics.js, icones.js
flows/                    gerador do Flow, JSON para a Meta e imagens
implantar.sh              cria Firestore/Cloud Tasks/permissões e publica no Cloud Run
test/                     testes (node:test), sem chamar sistemas reais
```

A imagem do Cloud Run leva só `server.js`, `package.json`, `api/` e os ícones de status (`.dockerignore`).

## Documentação

| Arquivo | Conteúdo |
|---|---|
| `LEIA-ME.md` | O que mudou na versão atual e o mapa do "Atualizar" |
| `ENGENHARIA-FLOW-INSCRICAO-DIRETA.md` | Como o Flow e o Run fazem a etapa 1 da Transferência, do Portador e do ENEM |
| `ENGENHARIA-REVERSA-VESTIBULAR-2027.md` | O site, passo a passo: inscrição, prova, matrícula, contrato e pagamento |
| `ENGENHARIA-REVERSA-VESTIBULAR-DOCUMENTOS-MATRICULA.md` | Documentos de matrícula (passo 300671) |
| `ENGENHARIA-REVERSA-TRANSFERENCIA-DOCUMENTOS.md`, `…-PORTADOR-DIPLOMA.md`, `…-NOTA-ENEM.md` | Etapa 1 de cada processo no site |
| `.claude/skills/verify/SKILL.md` | Como rodar a API localmente e percorrer as telas como a Meta |

## Configuração

Variáveis de ambiente (no Cloud Run; nunca no código):

| Variável | Para quê |
|---|---|
| `RBS_TOKEN` | Token da API do Rubeus |
| `FLOW_PRIVATE_KEY` / `FLOW_PASSPHRASE` | Chave privada do endpoint do Flow; também deriva as chaves do estado e da fila |
| `META_APP_SECRET` | Segredo do app Meta (confere a assinatura de cada requisição) |
| `FLOW_PROJECT_ID`, `FLOW_DATABASE_ID`, `FLOW_TASKS_REGION`, `FLOW_TASKS_QUEUE`, `FLOW_WORKER_ORIGIN` | Firestore e Cloud Tasks (preenchidas por `implantar.sh`) |
| `BLIP_API_URL`, `BLIP_BOT_KEY`, `BLIP_TEMPLATE_REDACAO`, `PIX_CHAVE` | Avisos e cobrança pelo Blip (sem elas, nada é enviado) |
| `PORT` | Opcional. Padrão `8080` |

## Testes

```bash
npm test
```

## Publicar

Um push no `main` publica no Cloud Run. Confira a versão:

```bash
curl -sS https://devflowunibalsas-git-83531798597.southamerica-east1.run.app/api/flow
```

Se o Flow mudou, gere (`node flows/gerar-etapa1.mjs`), cole `flows/etapa1-vestibular.json` no editor da Meta e publique.

## Cuidados

- Os logs não registram CPF, telefone, arquivos nem tokens.
- Gravação com resultado incerto nunca é reenviada; vai para conferência.
- Dados de teste são fictícios (4devs).
