# DevFlow UniBalsas

Endpoint do **WhatsApp Flow** dos processos seletivos 2027/1 da UniBalsas: inscrição (Vestibular, Transferência, Portador de Diploma e Nota do ENEM), redação, documentos de inscrição, matrícula, contrato e pagamento, sem sair do WhatsApp e seguindo o site do vestibular.

- Versão atual: **2.16.16** (`GET /api/flow` responde `unibalsas-cloudrun-jornada-2.16.16`; histórico em `LEIA-ME.md`)
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
Com status guardado, o LOGIN abre em ~2 s com o último status e o Run relê o portal em segundo plano.

**Etapa 2 — igual nos 4 processos** (só mudam os IDs de passo; mapa em `ENGENHARIA-REVERSA-ETAPA2-TRANSF-PORTADOR-ENEM.md`):

1. Responsável financeiro → pré-matrícula (endereço, identidade) → documentos de matrícula → análise da equipe.
2. Contrato: o Run gera o PDF (link exclusivo de 24 h); o candidato assina no GOV.BR e envia por e-mail → baixa da equipe.
3. Pagamento: liberado com o contrato assinado (o vigia avisa e guarda o valor). No Flow, a tela **Pagamento**
   mostra o valor e o botão **"Realizar pagamento"**; o pagamento NÃO é feito no Flow. O toque pede ao Run a mensagem
   do Blip (template de pagamento `order_details`): o Run gera o Pix no portal como o site (passo do processo:
   300670, 300701, 300686, 300716) e manda o copia e cola + o link do cartão. Tudo vem do sistema: Pix do TOTVS,
   valor (38658), recebedor e chave Pix lidos da própria cobrança. O Pix vale 1 h; "Reenviar mensagem" gera outro.
4. "Recebido" → "Aguardando confirmação da equipe" → a equipe libera o Matriculado **à mão** → aviso final.

Sem cupom em nenhuma tela do Flow (o passo de cupom do portal do Vestibular é pulado pelo worker). Recusa do RM
("Não foi possível fazer a matrícula!") vai para conferência da equipe e é retomada depois de 30 min.

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
| `ENGENHARIA-REVERSA-ETAPA2-TRANSF-PORTADOR-ENEM.md` | Etapa 2 (matrícula → contrato → pagamento → Matriculado) da Transferência, do Portador e do ENEM |
| `.claude/skills/verify/SKILL.md` | Como rodar a API localmente e percorrer as telas como a Meta |

## Configuração

Variáveis de ambiente (no Cloud Run; nunca no código):

| Variável | Para quê |
|---|---|
| `RBS_TOKEN` | Token da API do Rubeus |
| `FLOW_PRIVATE_KEY` / `FLOW_PASSPHRASE` | Chave privada do endpoint do Flow; também deriva as chaves do estado e da fila |
| `META_APP_SECRET` | Segredo do app Meta (confere a assinatura de cada requisição) |
| `FLOW_PROJECT_ID`, `FLOW_DATABASE_ID`, `FLOW_TASKS_REGION`, `FLOW_TASKS_QUEUE`, `FLOW_WORKER_ORIGIN` | Firestore e Cloud Tasks (preenchidas por `implantar.sh`) |
| `BLIP_API_URL`, `BLIP_BOT_KEY`, `BLIP_TEMPLATE_REDACAO`, `PIX_CHAVE`, `AVISOS_SO_PARA` | Avisos e cobrança pelo Blip (sem elas, nada é enviado). `BLIP_API_URL` sem `/commands`; `PIX_CHAVE` é só reserva (a chave vem da cobrança do Pix); `AVISOS_SO_PARA` = números de teste (só eles recebem) |
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

## Acompanhar o uso (logs)

Cada toque gera uma linha `flow_tela` (sessão anônima, tela de origem, ação, tela de destino, `ms`). Falhas usam
eventos `*_atencao`, `flow_client_error` e `rubeus_rejected`.

```bash
gcloud logging read 'resource.labels.service_name="devflowunibalsas-git" AND jsonPayload.event="flow_tela"' --project=talks-servidor --freshness=1h --order=asc --format="table(timestamp.date('%H:%M:%S'), jsonPayload.sessao, jsonPayload.de, jsonPayload.acao, jsonPayload.para, jsonPayload.ms)"
```

```bash
gcloud logging read 'resource.labels.service_name="devflowunibalsas-git" AND (jsonPayload.event=~"atencao" OR jsonPayload.event="flow_client_error" OR jsonPayload.event="rubeus_rejected")' --project=talks-servidor --freshness=1d --format="table(timestamp.date('%d/%m %H:%M'), jsonPayload.event, jsonPayload.motivo, jsonPayload.screen, jsonPayload.message)"
```

## Cuidados

- Os logs não registram CPF, telefone, arquivos nem tokens.
- Gravação com resultado incerto nunca é reenviada; vai para conferência.
- Dados de teste são fictícios (4devs).
