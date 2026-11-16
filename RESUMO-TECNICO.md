# Resumo técnico — WhatsApp Flows do Vestibular UniBalsas (14/11/2026)

Documento para dar contexto a outra IA ou pessoa técnica. Sem segredos e sem dados de candidatos.

## 1. O que é

Jornada de inscrição e matrícula da UniBalsas dentro do **WhatsApp Flows**, reproduzindo o site oficial `vestibular.unibalsas.edu.br/presencial` (processos 2027/1: Vestibular Online 20383, Transferência 20385, Portador de Diploma 20384, Nota do ENEM 20386).

| Peça | Tecnologia |
|---|---|
| Canal | WhatsApp Flows (Flow JSON **7.3**, Data API **3.0**), publicado na WABA operada pelo **Blip (Take)** |
| Endpoint do Flow | Node.js 22, sem dependências, **Google Cloud Run** `devflowunibalsas-git` (projeto `talks-servidor`, `southamerica-east1`) |
| Deploy | `git push` no `main` de `AlefMoraes21/devflowunibalsas` → Cloud Build → nova revisão no Cloud Run (**automático**) |
| CRM e portal do candidato | **Rubeus** — API oficial `admin.portal.apprbs.com.br` (`/start`, `/form`, `/submit`, `/data-source`, `/portal`, `/stages`, `/steps`) |
| Prova/redação | Plataforma de avaliação `avaliacao.apprubeus.com.br` (`linkProva`, `create/`, `consulta/`, `salve/`) |
| Acadêmico (TOTVS RM) | API da UniBalsas (`/blip/processos-seletivos`, `/blip/inscritos`, `/rm/documents`, `/blip/documents` em base64, limite de 1 MiB no corpo) |
| Tarefas lentas | Fila durável: **Firestore** (`unibalsas-flow`) + **Cloud Tasks** (fila `unibalsas-flow`, concorrência 10) + worker `/internal/flow-worker` (HMAC) |

## 2. Como o endpoint funciona

- `POST /api/flow`: requisições `data_exchange` cifradas (RSA-OAEP + AES-128-GCM). Ações via `data.acao`.
- **Estado selado:** cada tela devolve `estado` (AES-GCM) com o contexto (token do Rubeus, IDs de campos/botões, `applyment_id`, CPF da sessão). O cliente nunca altera identidade (o CPF do cliente vira `cpf_informado`).
- **Limite de 10 s da Meta** (não configurável). Orçamento interno de 9,5 s. Ações lentas viram **job**: o servidor responde "Só um instante ⏳" e o candidato toca "Verificar andamento"; o job é idempotente (id = hash de `flow_token` + `estado` + ação).
- Campos e botões são lidos do formulário do Rubeus por rótulo (IDs observados como reserva); os IDs mudam por processo.
- O Flow roda dentro do Blip: **não há `META_APP_SECRET`** (assinatura da Meta não é validada).

## 3. Jornada mapeada (detalhes: `ENGENHARIA-REVERSA-VESTIBULAR-2027.md` §6–15 e `MAPA-JORNADA-2027.md`)

Vestibular (20383): Dados básicos (300661) → Curso de interesse (300662, turno via `/data-source` ao escolher o curso) → Estamos quase lá (300663, conclui a inscrição) → Prova online (300664: "Iniciar prova" gera o IDEXECPROVA; a avaliação abre com `linkProva`) → **correção humana** → Resp. financeiro (300676) → Pré-matrícula: endereço (300666) e identidade (300667, o RM gera o RA) → Documentos de matrícula (300671, multipart `file_N` no site; no Flow via API UniBalsas base64) → **análise humana** → Contrato (300669: gera PDF em base64 no campo 52138; assinatura GOV.BR + e-mail) → **recebimento humano** → Taxa de matrícula (300670: Pix/cartão) → Matriculado.

Transferência/Portador/ENEM: inscrição → documentos de inscrição (e notas no ENEM) → **análise humana** → mesma sequência da matrícula.

## 4. O que foi feito (até a versão 1.6.17 + ajustes de 14/11)

- Engenharia reversa completa da jornada com 4 candidatos de teste (envios reais, capturas de tráfego).
- **1.6.16:** CEP gravado no endereço; CPF da sessão protegido no estado selado; orientação correta do contrato.
- Tela de curso: descarta opções repetidas/vazias; troca para curso sem turno limpa turno e oferta; nova busca vazia do mesmo curso mantém o turno (o Rubeus às vezes devolve lista vazia).
- Logs de diagnóstico: `flow_client_error` (aviso do WhatsApp), `turnos_carregados`.
- **Prova:** o Rubeus gera o IDEXECPROVA segundos depois do "Iniciar prova"; o servidor relê o formulário (até 6×2 s, sem reenviar). **1.6.17:** a redação é **pré-carregada** no job que conclui a inscrição (sem chamar `create/`, que inicia o cronômetro de 2 h).
- **Fim da etapa 1:** após a redação entregue e confirmada no portal, o Flow **fecha** (tela `CONFIRMACAO`) sem pedir login ("Já sou inscrito" com CPF + data de nascimento deixou de ser o caminho).
- 148 testes automatizados (`node --test "test/*.test.js"`).

## 5. Problemas conhecidos

- **WhatsApp Web** (Chrome/Edge) trava ao escolher o curso (Dropdown com `data_exchange` no `on-select`); app e prévia da WABA funcionam.
- Rubeus lento: conclusão da inscrição ~13 s; preparar a prova de segundos a ~45 s.
- Taxa de matrícula sem valor para um candidato de teste ("Não foi possível realizar o pagamento com o PIX!").
- "Como você ficou sabendo" (campo 319427) aparece vazio no CRM, inclusive pelo site.
- O aviso por WhatsApp prometido no fim da etapa 1 **ainda não existe**.

## 6. Para onde vamos: jornada por etapas

**Regra:** cada etapa é um Flow que faz tudo o que é automático até o ponto em que precisa de **validação humana**; ali o Flow fecha. Quando a equipe libera (no Rubeus), o sistema **prepara a próxima etapa em segundo plano** e só então **avisa o candidato pelo WhatsApp**, com o Flow da etapa seguinte abrindo já carregado (sem login).

| Etapa (Vestibular) | Termina em | Começa quando |
|---|---|---|
| 1. Inscrição + redação | Redação enviada (correção humana) | — |
| 2. Matrícula: resp. financeiro, endereço, identidade, documentos | Documentos enviados (análise humana) | Redação aprovada |
| 3. Contrato | Contrato assinado enviado (recebimento humano) | Documentos aprovados |
| 4. Pagamento | Pagamento confirmado | Contrato recebido |

**Ordem de construção acordada:**
1. **Primeiro os Flows** de cada etapa (JSON 7.3), validados na prévia da Meta e por testes.
2. **Depois a integração:** webhook do Rubeus (Integrações → Webhooks; evento "Entrou na etapa X"; payload de Contato traz CPF e nascimento; URL fixa e sem assinatura → caminho secreto + revalidar pela API) e disparo pelo **Blip** (API Active Campaign, `POST /commands`, `uri /campaign/full`, individual; template com o Flow; `flow_token` com uma referência opaca ao estado preparado).

## 7. Regras para quem for mexer

- **Não reiniciar o projeto**; preservar a arquitetura. Seguir o comportamento do site.
- **Push no `main` publica em produção.** Mudanças só com testes passando; publicar com autorização.
- **Flow JSON:** a resposta de cada tela só pode ter as chaves declaradas no `data` da tela publicada (chave extra quebra a tela no cliente). Condições do `If` não aceitam `&&`/`||` com `==`. Dropdown precisa de `id` único e título (máx. 30 caracteres). Mudou o JSON → republicar o Flow na Meta.
- **Não chamar `create/` da avaliação** antes de o candidato abrir a redação (inicia o cronômetro).
- Arquivos do repositório misturam CRLF e LF: preservar o fim de linha de cada arquivo.
- LGPD: nada de CPF, telefone ou tokens em logs, commits ou documentos.
