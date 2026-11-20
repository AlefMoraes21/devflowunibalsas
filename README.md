# DevFlow UniBalsas

Endpoint do **WhatsApp Flow** dos processos seletivos 2027/1 da UniBalsas: inscrição (Vestibular, Transferência, Portador de Diploma e Nota do ENEM), redação, documentos de inscrição, matrícula, contrato e pagamento, sem sair do WhatsApp e seguindo o site do vestibular.

- Versão atual: **2.17.6** (`GET /api/flow` responde `unibalsas-cloudrun-jornada-2.17.6`; histórico em `LEIA-ME.md`)
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
O worker é chamado 10 s depois de cada tela gravada; se o Rubeus falhar, tenta de novo por até 72 h (ver
"Reenvio quando o Rubeus falha").

**Cursos fixos no Flow** (`api/cursos-fixos.js`): os 11 cursos ficam no JSON, com o turno no subtítulo
("Turno: Noturno"; Medicina Veterinária e Odontologia "Turno: Integral"). Escolher o curso não chama o Run. O worker
acha o curso na lista do Rubeus do processo pelo começo do nome, consulta os turnos e escolhe pelo nome. Curso que o
Rubeus não tiver no processo vai para conferência (`curso_indisponivel`). Atualizar o arquivo a cada semestre.

O estado de cada tela vai selado (AES-GCM) no campo `estado`, nunca vindo do cliente. Telas que não são do Flow atual
(`INSC_*`, `MATR_*`, `CONTR_*`) recebem uma tela de fim com orientação.

### Regras do Flow para funcionar também no WhatsApp Web (testes de 19 e 20/11/2026)

- **Sem `CalendarPicker`**: na 1ª passada, a tela seguinte herdava o botão "Iniciar inscrição" da 1ª tela. Usar `DatePicker`.
- **Sem resposta do Run com a mesma tela** (ex.: escolher o curso e o Run devolver a tela de curso com os turnos): o Web
  mostrava a 1ª tela. Dados que não mudam ficam fixos no JSON.
- **Sem ciclo de rotas**: todo `navigate` precisa estar no `routing_model`, sem voltar a uma tela anterior. A política
  de privacidade abre o site (`open_url`).
- Rótulo de lista (`Dropdown`) com até 20 caracteres (aviso da Meta) e opção com título até 30.

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
api/retentativas.js       ritmo de reenvio ao Rubeus quando falha (10 s … 72 h, 20 tentativas)
api/processes.js          política e documentos de inscrição por processo
api/cursos-fixos.js       cursos e turnos fixos do Flow e a busca do curso no Rubeus pelo nome
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
| `BLIP_API_URL`, `BLIP_BOT_KEY`, `BLIP_FLOW_ID`, `BLIP_STATE_ID`, `BLIP_MASTERSTATE` | Avisos e cobrança pelo Blip (sem URL e chave, nada é enviado). `BLIP_API_URL` sem `/commands` |
| `BLIP_TEMPLATE_ATUALIZACAO`, `BLIP_TEMPLATE_COBRANCA` | Opcionais. Padrão `unibalsas_atualizacao_processo` e `unibalsas_cobranca_matriculav1` |
| `PIX_CHAVE` | Reserva: a chave Pix vem da própria cobrança; usada quando a cobrança traz chave aleatória (EVP) |
| `AVISOS_SO_PARA`, `AVISOS_DESLIGADOS` | Números de teste (só eles recebem avisos) e chave geral para desligar os avisos |
| `PORT` | Opcional. Padrão `8080` |

## Tempos de cada etapa

O candidato não espera nenhum destes tempos: o Flow responde na hora e o worker faz o resto depois.

| Etapa | Quando vai ao Rubeus / portal | Variável (padrão) |
|---|---|---|
| Inscrição (dados, curso, "Estamos quase lá") | 10 s depois de cada tela gravada; em falha, o ritmo de reenvio abaixo (até 72 h) | — |
| Matrícula (responsável, endereço, identidade) | 10 s depois de cada tela gravada; em falha, o ritmo de reenvio abaixo (até 72 h) | — |
| Redação (Vestibular) | 10 min depois da **inscrição concluída** (o Rubeus ainda monta a prova) + 1 min conferindo que a prova não mudou; se mudou, espera mais 10 min. Redação escrita depois desses 10 min vai em ~1 min | `ETAPA1_ESPERA_PROVA_MS` (600000), `ETAPA1_ESTABILIDADE_MS` (60000) |
| Documentos de inscrição | 1 min depois da inscrição concluída (o RM ainda sincroniza); sem a etapa no portal, tenta a cada 10 min por até ~24 h | `ETAPA1_ESPERA_DOCS_MS` (60000) |
| Documentos de matrícula | 2 min depois do envio pelo Flow | `ETAPA2_ESPERA_DOCS_MS` (120000) |
| Contrato (gerar o PDF) | 2 min de calma depois de a etapa ser liberada | `ETAPA3_CALMA_MS` (120000) |
| Cobrança (Pix + cartão pelo Blip) | na hora do toque em "Realizar pagamento"; toque repetido em menos de 1 min é ignorado | — |
| LOGIN (status) | ao vivo, ~2 a 7 s; com status guardado abre na hora e relê o portal em segundo plano | `ETAPA2_ESPERA_STATUS_MS` (7500), `ETAPA2_ESPERA_PORTAL_MS` (6500) |

## Reenvio quando o Rubeus falha (`api/retentativas.js`)

Vale para os dois workers que gravam no Rubeus: inscrição, redação e documentos de inscrição (etapa 1) e matrícula
com os documentos de matrícula (etapa 2). Os dados chegam no Run e a 1ª tentativa sai em 10 s. Se falhar:

| Tentativa | Espera antes dela | Tempo desde a chegada dos dados |
|---|---|---|
| 1ª | 10 s | 10 s |
| 2ª | 30 s | 40 s |
| 3ª | 2 min | 2 min 40 s |
| 4ª | 30 min | 32 min 40 s |
| 5ª | 30 min | 1 h 2 min 40 s |
| 6ª a 10ª | 1 h cada | 6 h 2 min 40 s |
| 11ª a 20ª | 6 h 35 min 44 s cada | **72 h** |

- Depois da 20ª tentativa a fila fica `falhou`, **guardada no Firestore** (criptografada, até 30 dias da criação),
  com o log `etapa1_fila_atencao` / `etapa2_fila_atencao` para a equipe. A matrícula reabre sozinha quando o
  candidato entra de novo pelo LOGIN.
- **O Run fica desligado na espera:** cada tentativa é uma tarefa agendada no Cloud Tasks; o Cloud Run liga só
  para tentar (segundos) e volta a zero. As horas de espera não custam nada.
- **Falhas antigas não somam:** quando o passo que falhou dá certo (ou um bloco da matrícula é gravado), as
  tentativas voltam a zero.
- Não entram neste ritmo: recusas definitivas do Rubeus (já inscrito, curso indisponível, resultado incerto no
  envio da conclusão ou da redação), que vão direto para a equipe conferir sem reenvio; as esperas de propósito
  (redação 10 min + 1 min, documentos 1 e 2 min, contrato 2 min); a espera pelo portal mostrar "Documentos
  inscrição" (a cada até 10 min por ~25 h); os vigias e os avisos/cobrança do Blip (5 tentativas).

**Resposta incompleta do portal nunca vira "concluída"** (2.17.2): etapas vazias → tenta de novo; botão de etapa
num formato que não seja `presencial/passo/<n>` ou `presencial/feedback/<n>` → a equipe confere (`portal_formato`).
Documentos de inscrição só contam como "já em análise" quando a etapa não tem botão de envio.

**Sessão vencida no meio das tentativas** (2.17.3): a sessão do Rubeus guardada vale 3 h. Vencida antes da conclusão,
recomeça numa sessão nova; na redação ainda não enviada, entra de novo pelo CPF e data de nascimento; na redação já
enviada esperando confirmação, vai para a equipe conferir (nunca reenvia).

**Refazer a redação pelo LOGIN** (2.17.4): com a prova liberada de novo no portal e a entrega anterior com 1 h ou
mais, a redação abre de novo no Flow (entrega recente continua como "Redação enviada").

## Varredura de tarefas perdidas e comando "acordar" (2.17.5)

Cada fila da etapa 1 (`inscricoesFila`) e da etapa 2 (`matriculaFila`) guarda a hora em que a próxima tentativa
deve rodar (`proximaAcaoEm`, uma data fora da criptografia; os dados continuam no blob criptografado). Ela é marcada
antes de agendar no Cloud Tasks e enquanto o worker roda (até a trava de 170 s vencer), e sai quando a fila termina,
espera o candidato ou vai para a equipe. Quem falhou de vez ganha `falhouEm`.

`POST /internal/reconciliar` procura as filas com `proximaAcaoEm` vencida há mais de 10 min (tarefa que se perdeu,
agendamento que falhou, execução que caiu no meio) e agenda de novo, uma vez:

| Corpo | O que faz |
|---|---|
| `{}` | Religa as filas paradas; tira a marca das que só esperam o candidato (nunca chama o Rubeus por elas) |
| `{"simular": true}` | Só conta, sem mexer em nada |
| `{"reabrir_falhas": true}` | Além disso, recomeça do zero (tentativas = 0) as que ficaram `falhou` depois das 20 tentativas |

- Autenticação: ID token do Google de um e-mail listado em `RECONCILIAR_EMAILS` (separados por vírgula). Sem a
  variável, a rota responde 403 para todos. Aceita o token do Cloud Scheduler (audiência = URL do serviço) e o do
  `gcloud auth print-identity-token` de quem está na lista.
- Responde `{ ok, resultado: { etapa1: {reenviadas, limpas, ocupadas, reabertas}, etapa2: {…} } }` e grava o log
  `reconciliar_fim`.
- Os vigias (redação, inscrição, contrato, etapa final) não entram: continuam religados pelo LOGIN do candidato.

**Comando "acordar"** (PowerShell, com o gcloud logado num e-mail da lista):

```powershell
$t = gcloud auth print-identity-token
Invoke-RestMethod -Method Post -Uri https://devflowunibalsas-git-a2yea7tx2q-rj.a.run.app/internal/reconciliar -Headers @{Authorization = "Bearer $t"} -ContentType 'application/json' -Body '{"reabrir_falhas": true}'
```

**Varredura automática** (Cloud Scheduler a cada 30 min; o Run liga ~1 s por chamada e volta a zero):

```powershell
gcloud iam service-accounts create unibalsas-varredura --project talks-servidor
gcloud run services update devflowunibalsas-git --project talks-servidor --region southamerica-east1 --update-env-vars "^;^RECONCILIAR_EMAILS=unibalsas-varredura@talks-servidor.iam.gserviceaccount.com,<e-mail da equipe no gcloud>"
gcloud scheduler jobs create http unibalsas-varredura --project talks-servidor --location southamerica-east1 --schedule "*/30 * * * *" --http-method POST --uri https://devflowunibalsas-git-a2yea7tx2q-rj.a.run.app/internal/reconciliar --headers Content-Type=application/json --message-body "{}" --oidc-service-account-email unibalsas-varredura@talks-servidor.iam.gserviceaccount.com --oidc-token-audience https://devflowunibalsas-git-a2yea7tx2q-rj.a.run.app
```

**Cobrança sem mensagem em dobro** (2.17.6): antes de chamar o Blip, a fila grava a marca `cobranca_enviando` do pedido.
Se a execução cair depois disso, ou o Blip não responder (tempo esgotado, rede, 5xx), a cobrança conta como enviada e
**não é repetida sozinha**; o candidato vê "Enviamos…" e pode tocar em "Reenviar mensagem" (pedido novo). Log de atenção
`envio_interrompido` / `blip_sem_resposta`. Recusa clara do Blip continua tentando de novo (até 5×, mesmo Pix). Na fase
de teste, celular fora do `AVISOS_SO_PARA` não gera Pix nem alerta a equipe. Roteiro de homologação: `ROTEIRO-HOMOLOGACAO.md`.

## Avisos pelo Blip (vigias)

Cada vigia é uma tarefa do Cloud Tasks que relê o portal e avisa quando a etapa muda. Ritmo: 1ª conferência 2 min
depois de ligar; depois a cada **10 min nas primeiras 2 h** e a cada **1 h** até 15 dias (o vigia final, até 30 dias).
Variáveis: `VIGIA_PRIMEIRA_S` (120), `ETAPA3_VIGIA_INTERVALO_S` (600), `VIGIA_INTERVALO_LONGO_S` (3600), `VIGIA_PAGAMENTO_S` (120).

| Vigia | Quando liga | Aviso |
|---|---|---|
| `redacao_vigia` | redação enviada (Vestibular) | redação corrigida e aprovada: segue para a matrícula |
| `inscricao_vigia` | documentos de inscrição enviados (Transf., Portador, ENEM) | documentos aprovados ou recusados (pede só os recusados) |
| `etapa3_vigia` | documentos de matrícula enviados | documentos aprovados; contrato liberado (só com os documentos aprovados) |
| `etapa4_vigia` | contrato com baixa da equipe | pagamento liberado; com "Realizar pagamento", a cobrança Pix + cartão; depois de enviada, confere a cada 2 min por 70 min; "Recebido"; Matriculado |

## Cloud Run

Escala até zero quando parado (sem instância mínima; não há custo de máquina parada), até 3 instâncias,
20 requisições por instância, 1 vCPU e 512 MiB, com *startup CPU boost*. Os vigias e o worker acordam o serviço
pelo Cloud Tasks. A 1ª chamada depois de parado leva ~1 s a mais.

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
