---
name: verify
description: Rodar a API do Flow localmente (Google simulado, Rubeus/portal reais) e percorrer as telas pelo endpoint criptografado, como a Meta faz.
---

# Verificar o Flow localmente

O servidor de verdade (`server.js`) roda com um preload (`mock-google.mjs`) que troca só o que precisa de
credencial do Cloud Run:
- metadata/Firestore/Cloud Tasks do Google: em memória; as tarefas ficam numa fila manual.
- CDN de mídia da Meta: `https://mock-cdn.test/…`, com arquivos criptografados como os do DocumentPicker.
- API de parceiro do Rubeus (`admin.portal.apprbs.com.br`, pede o RBS_TOKEN): o login e o /portal são
  respondidos com os dados REAIS do site (login-portal + register-portal-data) do mesmo candidato.
- O Blip fica sem configuração e o host é bloqueado: nenhum aviso real sai.

O site do vestibular, a API da UniBalsas e o ViaCEP são chamados de verdade.

## Subir

Rode na raiz do repositório e deixe em segundo plano:

```
$env:VERIFY_REPO=(Get-Location).Path
node .claude/skills/verify/start.mjs
```

- O servidor fica na porta 8080 e o controle na 8099. A cada subida é gerado um par de chaves RSA novo
  (`pub.pem`).
- Para os vigias rodarem em segundos, suba com `ETAPA3_VIGIA_INTERVALO_S=2`, `VIGIA_PRIMEIRA_S=2` e
  `VIGIA_INTERVALO_LONGO_S=2`. Disparar uma tarefa antes do horário dela faz o vigia tratá-la como
  "corrente antiga" e não fazer nada.

## Controle (porta 8099)

| Rota | O que faz |
|---|---|
| `GET /tasks` | Lista as tarefas na fila |
| `POST /dispatch {tipo,id}` | Executa uma tarefa no `/internal/flow-worker` |
| `POST /task {id,tipo}` | Cria uma tarefa assinada |
| `GET /store?col=` | Lê o Firestore simulado |
| `POST /put {col,id,record}` | Grava um registro no Firestore simulado |
| `POST /media {name}` | Cria uma mídia de teste |
| `POST /env {...}` | Muda variáveis de ambiente com o servidor rodando |
| `GET /outside` | Mostra os hosts externos chamados |
| `POST /age {col,ms}` | Recua em `ms` a próxima ação (e a data da falha) da coleção, para testar a varredura |
| `POST /clear-tasks` | Apaga as tarefas da fila (simula tarefa perdida) |

Varredura: suba com `RECONCILIAR_EMAILS=equipe@example.com` e chame `POST /internal/reconciliar` com
`Authorization: Bearer verify-equipe_at_example.com` (o mock do tokeninfo troca `_at_` por `@`). Não
despache as tarefas `etapa1` que ela religar: falam com o Rubeus real.

## Cenários

Todos usam `lib.mjs`: o cliente criptografa como a Meta e confere cada resposta com o `data` da tela em
`flows/etapa1-vestibular.json`.

| Script | O que percorre |
|---|---|
| `enem.mjs` | ENEM: CURSO_ENEM → QUASE_LA → STATUS → DOC_A |
| `transf.mjs` | Transferência e Portador, com 3 documentos |
| `vest.mjs` | Confirma que o Vestibular continua indo para a prova |
| `login2.mjs <juan\|rosa\|rebeca>` | LOGIN → Atualizar → lista com ícones → vigia → 2º LOGIN (V1) |
| `multipla.mjs <seguir|nova|login>` | Aviso de inscrição existente com a Rebeca (portal real); ligue `TELAS_INSCRICAO_MULTIPLA=on` pelo `/env` |
| `worker.mjs <quem>` | Worker `docs_inscricao` no portal real, com registro semeado |

## Cuidados

- As telas da inscrição precisam do cache de cursos semeado (`flowCache/etapa1-<processo>`), porque quem
  preenche esse cache é o worker que grava no Rubeus.
- Não dispare a tarefa `etapa1` de uma inscrição nova: ela cria a inscrição de verdade no Rubeus.
- `worker.mjs` só é seguro quando os documentos do candidato já estão "Em análise". Com "Pendentes
  [Verificar]", ele envia o PDF de teste ao portal.
- Os candidatos de teste são fictícios (4devs): Rebeca (Transferência), Rosa (Portador) e Juan (ENEM).
