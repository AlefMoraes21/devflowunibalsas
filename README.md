# DevFlow UniBalsas

Endpoint do **WhatsApp Flow** de inscrição nos processos seletivos da UniBalsas. O candidato faz a inscrição, a redação online, acompanha as etapas e envia documentos sem sair do WhatsApp. O servidor traduz cada tela do Flow em chamadas ao **Rubeus** (CRM e portal do candidato), ao módulo de **avaliação** (redação) e à **API acadêmica da UniBalsas** (documentos).

- Versão atual: **1.6.3** (`GET /api/flow` responde `unibalsas-cloudrun-jornada-1.6.3`)
- Execução: Node.js 22+, sem dependências externas (`npm install` não baixa pacotes)
- Hospedagem: Google Cloud Run (`southamerica-east1`), com Firestore e Cloud Tasks para tarefas lentas
- Flow: JSON versão 7.3, Data API 3.0 (`flow-waba.json`)

## Como funciona

```
WhatsApp Flow ──(data_exchange, criptografado)──▶ POST /api/flow ──▶ Rubeus (inscrição e portal)
                                                        │          ├─▶ Módulo de avaliação (redação)
                                                        │          └─▶ API UniBalsas (documentos)
                                                        ▼
                                          Firestore + Cloud Tasks (tarefas lentas)
                                                        ▼
                                          POST /internal/flow-worker
```

A Meta dá no máximo 10 s para o endpoint responder. Por isso as operações lentas (gravar curso e notas, concluir inscrição, abrir a prova, enviar a redação, consultar o portal, enviar documento) viram um **job** durável:

1. O Flow envia a ação; o servidor grava o job no Firestore (cifrado com AES-GCM, expira em 2 h) e agenda no Cloud Tasks.
2. A tela mostra "Só um instante ⏳" e o botão **Verificar andamento**.
3. O worker (`/internal/flow-worker`, assinado por HMAC) executa a operação uma única vez; clique repetido gera o mesmo job.
4. Cada "Verificar andamento" lê o estado real do job. Nada é confirmado antes do retorno do sistema de destino.

O estado de cada tela vai selado (AES-GCM) no campo `estado`, nunca vindo do cliente.

## Jornada

| Processo | Rubeus / IDPS | Caminho |
|---|---|---|
| Vestibular Online | 20383 / 223 | dados básicos → curso → "Estamos quase lá" → redação |
| ENEM | 20386 / 226 | dados básicos → curso e notas → "Estamos quase lá" → comprovante |
| Transferência | 20385 / 225 | dados básicos → curso → "Estamos quase lá" |
| Portador de Diploma | 20384 / 224 | dados básicos → curso → "Estamos quase lá" |

Depois da inscrição o Flow não fecha: abre o painel de **acompanhamento** com a situação de cada etapa do portal. Quem já se inscreveu entra por **Já sou inscrito** (CPF + data de nascimento) e continua por responsável financeiro, dados do responsável, endereço, identidade, cupom, documentos, contrato e pagamento.

### Documentos pelo WhatsApp

A tela `DOCUMENTOS_INSCRICAO` usa o componente nativo **DocumentPicker**:

1. `GET /rm/documents` lista os documentos exigidos pelo processo (`CODDOCUMENTO`).
2. `GET /blip/inscritos/{idps}/{cpf}` devolve o `NUMEROINSCRICAO`.
3. O Flow entrega ao endpoint `cdn_url` + chaves de criptografia; o servidor baixa o arquivo, confere SHA-256/HMAC, descriptografa (AES-256-CBC) e confere o tipo pelo conteúdo (PDF, JPG ou PNG, até 740 KB).
4. `POST /blip/documents` envia o arquivo em Base64. O sucesso só é mostrado com `status: ok` e a chave `primaryKey` esperada.

A API da UniBalsas grava o documento como **não conferido**; a equipe confere manualmente. Documentos de matrícula (RG, CPF, histórico), contrato e pagamento ainda abrem o Portal do candidato.

## Estrutura

```
server.js              servidor HTTP (/api/flow, /internal/flow-worker, /healthz)
api/flow.js            roteador do Flow: telas, ações, estado selado, Rubeus
api/jobs.js            fila durável: job, polling, worker, idempotência
api/cloud-store.js     Firestore, Cloud Tasks, cifragem dos jobs
api/matricula.js       login do candidato e telas de matrícula
api/documentos.js      API da UniBalsas e mídia do DocumentPicker
api/avaliacao.js       módulo de avaliação (redação)
api/prova-route.js     link oficial da prova
api/proof-binding.js   vínculo prova ↔ inscrição
api/prompt-text.js     texto do tema da redação
api/enem.js            notas e média do ENEM
api/processes.js       política por processo seletivo
api/diagnostics.js     resume erros de validação do Rubeus sem os valores enviados
flow-waba.json         JSON do Flow para colar na Meta
implantar.sh           cria Firestore/Cloud Tasks/permissões e publica no Cloud Run
test/                  testes automatizados (node:test)
LEIA-ME.md             histórico de versões e notas de cada entrega
ENGENHARIA-REVERSA-VESTIBULAR-2027.md   endpoints do site e do módulo de avaliação
```

## Configuração

Variáveis de ambiente (configure no Cloud Run; nunca no código):

| Variável | Para quê |
|---|---|
| `RBS_TOKEN` | Token da API do Rubeus |
| `FLOW_PRIVATE_KEY` / `FLOW_PASSPHRASE` | Chave privada do endpoint do Flow; também deriva as chaves do estado e dos jobs |
| `APP_SECRET` / `META_APP_SECRET` | Segredo do app Meta (assinatura das requisições) |
| `FLOW_PROJECT_ID`, `FLOW_DATABASE_ID`, `FLOW_TASKS_REGION`, `FLOW_TASKS_QUEUE`, `FLOW_WORKER_ORIGIN` | Firestore e Cloud Tasks (preenchidas por `implantar.sh`) |
| `UNIBALSAS_API_URL` | Opcional. Padrão `https://api.unibalsas.edu.br` |
| `PORT` | Opcional. Padrão `8080` |

## Testes

```bash
npm test
```

Roda `test/*.test.js` com `node --test`. As chamadas ao Rubeus, à avaliação e à API da UniBalsas são **simuladas**; nada é gravado em sistemas reais.

## Publicar

Primeira vez (cria Firestore, fila e permissões, depois publica):

```bash
bash implantar.sh
```

Atualizações:

```bash
gcloud run deploy devflowunibalsas-git --project=talks-servidor --region=southamerica-east1 --source=.
```

Confira a versão publicada:

```bash
curl -sS https://devflowunibalsas-git-83531798597.southamerica-east1.run.app/api/flow
```

Depois de qualquer mudança no `flow-waba.json`, cole o JSON novo no Flow da Meta e reabra o Flow em uma sessão nova.

## Cuidados

- Os logs não registram CPF completo, arquivos, Base64 nem tokens.
- Nunca reenviamos uma gravação cujo resultado é incerto; o candidato é orientado a conferir no Portal.
- Dados de teste usam o sufixo "Teste" no nome, para localizar no CRM.
