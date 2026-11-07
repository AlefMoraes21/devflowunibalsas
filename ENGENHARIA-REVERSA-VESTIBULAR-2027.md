# Engenharia reversa — Vestibular Online 2027/1 (UniBalsas)

Capturado em 06/11/2026 no site `vestibular.unibalsas.edu.br/presencial` e no módulo de avaliação `avaliacao.apprubeus.com.br`, com uma inscrição de teste real.

## Inscrição de teste (para localizar no CRM)

| Item | Valor |
|---|---|
| Nome | MARIA FICTICIA SOUZA TESTE |
| E-mail | maria.ficticia.teste@example.com |
| Celular | (99) 98888-0001 |
| Processo | 20383 — Vestibular Online - Cursos presenciais - 2027/1 (IDPS 223) |
| Curso / turno | Análise e Desenvolvimento de Sistemas (`1-450`) / Noturno (`6`) |
| applyment_id | **14083470** |
| person_id | 9985265 |
| contato CRM | 605648 (`external_code` 20049, NUMEROINSCRICAO 188) |
| Execução da prova | IDEXECPROVA `785BD0E98A`, execução 708016, avaliação 330, questão 65711 |
| Situação final no portal | Inscrição: Concluída · Prova online: **Aguardando correção** |

A redação enviada termina com a palavra "Teste".

## 1. Site de inscrição (`/api/applyment/*`, portal 257)

Todas as chamadas são `POST` com JSON e levam o `token` público do portal (vem de `settings/`).

| Ordem | Endpoint | Corpo relevante | Resposta relevante |
|---|---|---|---|
| 1 | `settings/` | — | `token`, `crm_domain`, cores |
| 2 | `applyment/` | `token` | lista de processos: 20383, 20385, 20384, 20386 |
| 3 | `start-applyment` | `process_id, execute_stage_query:1, token` | primeiro passo `300661` |
| 4 | `getApplymentDataByStep/{passo}` | `execute_stage_query, token, process_id` | `content` com campos (`field_id`), botões, `query_data` com as opções |
| 5 | `button-click` | `button_id, last_place_id, stage_id, selective_process_id, data:[{field_id,value,...}], token` | `place_id` (próximo passo), `person_id`, `applyment_id` |
| — | `validate-access`, `check-login`, `stage-steps/` | apoio de navegação | — |
| pós | `register-portal-data` | `token, domain, return_applyments` | etapas + `feedback.complementary_text` (status exibido no portal) |

### Passos e campos enviados

**300661 – Dados básicos** (botão `3940350`): nome 38544, e-mail 38545, celular 38546 (o site envia **só dígitos**), IDPS 38548 = `"223"`, gênero 38564 (`M`/`F`), gênero Rubeus 38565 (`1`/`2`), nascimento 38566 (`AAAA-MM-DD`), possui nome social 38606, aceite LGPD 38679 = `true`, LGPD assinatura 38707 = `"1"`, base legal 38708 = `"4"`.

**300662 – Curso de interesse** (botão `3940360`): curso 38627 = `1-450`, turno 38547 = `6`, CODOFERTA 38552 = `1-223-493`, área 38553 = `493`, CODTIPOCURSO 38610 / CODCOLIGADA 38611 / CODFILIAL 38612 = `1`. Não há CODPOLO no vestibular.

**300663 – Estamos quase lá** (botão `3940366` "Concluir"): CPF 38567, nacionalidade 38780 (`10`), ensino médio 251544 (`Sim`/`Não`), deficiência 38575 (`T`/`F`) + 38576–38583, origem 319427, outro 319428. Códigos reais da origem (`query_data` TOTVS `SPSINSCAREAOFERTACOMPL.COMO_FICOU_SABENDO`): `01` Site oficial … `10` Outro — **idênticos** a `ORIGENS_PADRAO` do Flow.

Ao concluir, o site redireciona para `seletivo.unibalsas.edu.br/obrigado-3`.

## 2. Etapa de prova (stage 261000, passo 300664)

Campos de controle no passo: TOKENPROVA 38593, IDEXECPROVA 38590 (vazio antes de iniciar), IDPROVAINSCRITO 38620, Status da inscrição 38639 = `1`, Status da prova 38592 (antes de iniciar: `parâmetros obrigatórios não enviados!`), Status da opção 38623 = `0`.

Botões: **Iniciar prova** (`3940382`) e **Continuar Prova** (`3940383`), ambos com redirecionamento para `https://avaliacao.apprubeus.com.br/api/avaliacao/linkProva` com os parâmetros `chave`←38593, `codigoContato`←38608, `codigoOferta`←38552, `origemContato`=`121` (fixo), `idExecProva`←38590.

## 3. Módulo de avaliação (`avaliacao.apprubeus.com.br`)

1. `GET /api/avaliacao/linkProva?...` → redireciona para `/execucao/inicio/{chave}/{crm_contato_id}/{crm_curso_id}/{IDEXECPROVA}` (ex.: `.../605648/926/785BD0E98A`).
2. `POST /api/avaliacao/configuracao/execucao/` → textos de orientação, `avaliacao_id` 330, `crm_id` 94.
3. `POST /api/avaliacao/create/` com `{chave, crm_contato_id, crm_curso_id, crm_processoseletivo_id:null, IDEXECPROVA, codUsuarioPS:null}` → `{token}`. **O cronômetro de 120 min começa aqui.**
4. `GET /api/avaliacao/consulta/{token}` → prova com `tempo`/`tempoRestante` 120, `copiarcolar:0` (colar bloqueado no site), 1 questão aberta (`tipo_id` 1) com o enunciado em HTML.
5. `POST /api/avaliacao/salve/` com `{id, avaliacao_id, crm_contato_id, crm_curso_id, crm_id, crm_processoseletivo_id, IDEXECPROVA, codUsuarioPS, nome, questoes:[{questao_id, obrigatoria:1, tipo:1, resposta}], tempoUsado, finalizada:1, salvar:1, salvarEstadoAtual:1, finalizada_automaticamente:0}` → recibo com `finalizada:1`, `data_envio`.
6. Portal passa a mostrar "Prova online — Aguardando correção".

Tema real desta prova: **"O papel da educação na redução das desigualdades sociais"**.

## 4. Comparação com o endpoint do Flow (v1.4.0, igual ao Cloud Run)

| Ponto | Site observado | Flow / código | Situação |
|---|---|---|---|
| IDs de campos e botões dos 3 passos | ver seção 1 | `buildBasicScreenData`, `buildCourseScreenData`, `buildAlmostThereScreenData` (com fallbacks iguais) | ✅ igual |
| Valores ocultos (IDPS 223, LGPD 1/4, gênero Rubeus 1/2) | enviados pelo site | enviados pelo Flow | ✅ igual |
| Códigos de origem 01–10 | `query_data` TOTVS | `ORIGENS_PADRAO` | ✅ igual (títulos encurtados por limite de 30 caracteres do Dropdown) |
| Celular | só dígitos `99988880001` | formatado `(99) 98888-0001` | ⚠️ diferente — avaliar se o CRM normaliza |
| Escolha Iniciar/Continuar prova | status 38592 + opção 38623 | `chooseProofButton` | ✅ cobre o status inicial "parâmetros obrigatórios…" |
| Rota `/execucao/inicio/...` com código alfanumérico | IDEXECPROVA | regex de `avaliacao.init` | ✅ igual |
| Corpo de `create` e `salve` | seção 3 | `avaliacao.init` / `avaliacao.send` | ✅ chaves idênticas |
| Confirmação no portal | "Aguardando correção" | `portalConfirmsDelivery` (`/aguardando.*correc/`) | ✅ reconhecida |
| Tema exibido na TELA_REDACAO | enunciado HTML da questão | `promptText` → 1025 caracteres legíveis | ✅ testado com o enunciado real |
| Tema fixo em `enviar_informacoes_complementares` | — | "A romantização da produtividade…" | ⚠️ texto antigo, não exibido no layout atual (dado morto) |
| Limite da redação | sem limite (`maxCaracteres` null) | TextArea `max-length` 3000 | ℹ️ limite do WhatsApp |
| Colar texto | bloqueado no site | permitido no WhatsApp | ℹ️ diferença de canal |

Testes do repositório: `node --test "test/*.test.js"` → 73/73 passam. (Os `*.test.js` soltos na raiz são cópias antigas e falham por caminho relativo; podem ser removidos.)

## 5. Etapas após a prova (mapeadas em 06/11/2026, mesma inscrição de teste)

A correção aprovou a redação (status da opção 38623 = 4). O portal então libera as etapas abaixo. Os IDs de passo são do processo 20383; o Portador de Diploma tem a mesma estrutura em 300677–300690.

| Etapa (stage) | Passo | Conteúdo | No Flow 1.5.0 |
|---|---|---|---|
| Seleção resp. financeiro | 300676 | rádio 232542 "Eu"/"Outro", botão Concluir 3940483, oculto CODUSUARIOPS 38608 | `RESP_FINANCEIRO` |
| Resp. financeiro / menor 18 | 300668 / 300675 | nome 38710, e-mail 38692, CPF 38688, nascimento 38691, celular 38682, endereço 38714/38711/38726/38681/38684/38701, estado/cidade natal 38728/38727 | `RESP_DADOS` |
| Pré-matrícula – Dados de endereço | 300666 | CEP (componente; site chama `POST /api/applyment/cep`), rua 38569, número 38570, complemento 38572, bairro 38571, cidade 38574, UF 38573, estado natal 38641, cidade natal 38640 (5.568 cidades) | `ENDERECO` |
| Pré-matrícula – Identidade | 300667 | RG 38642, órgão 38643, UF 38644 (27), cor/raça 38645 (7), estado civil 38646 (9), escola 38699 (1.461, opcional), ano 38680 (1995–2027) | `IDENTIDADE` |
| Cupom de desconto | 300674 | texto 98519, botão "Ativar Cupom" | `CUPOM` |
| Documentos inscrição / matrícula | 300665 / 300671 | upload multipart (`file_0…`) com itens por CODTIPODOCUMENTO/CHAVERM: RG, CPF, histórico*, certificado*, comprovante, docs do responsável, declaração* | `ETAPA_PORTAL` (portal) |
| Contrato | 300669 | download (popup 765) + aceite 38635, data 38636, IP 52136 | `ETAPA_PORTAL` (portal) |
| Pagamento – Taxa de matrícula | 300670 | meio 38702 (Pix/Cartão/Boleto) → popups 1016/577/764 | `ETAPA_PORTAL` (portal) |
| Taxa de inscrição | 300672 | meio 38637, boleto | `ETAPA_PORTAL` (portal) |
| Filiação | 300673 | cadastro na página 434 | `ETAPA_PORTAL` (portal) |

Situação da inscrição de teste após o mapeamento: Inscrição concluída, Prova aprovada, Seleção resp. financeiro concluída ("Eu"), Pré-matrícula concluída (endereço e identidade fictícios), Documentos de matrícula pendentes, Contrato aguardando documentação. **Nenhum documento foi enviado, nenhum contrato aceito e nenhuma cobrança gerada.**

### O que a API oficial não cobre

A documentação da Rubeus (`docs.rubeus.com.br`) não descreve upload de arquivos em `/submit`, aceite de contrato, popups nem Pix. Por isso essas etapas abrem o portal. Para trazê-las para dentro do Flow (DocumentPicker, OptIn de contrato, Pix copia-e-cola), é preciso confirmar com a Rubeus o formato aceito, ou autorizar um envio de teste nesta inscrição.
