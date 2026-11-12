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

## 6. Reverificação no site (10/11/2026) — contrato do `button-click` e portões de acesso

Captura feita no site oficial com um gancho em `XMLHttpRequest` que **bloqueava** o `button-click` (nenhum dado foi gravado no Rubeus; só as chamadas normais de tracking do site). Identidade usada: "Helena Ribeiro Duarte Teste", e-mail `@example.com`.

**`POST /api/applyment/button-click`** (multipart/form-data; o corpo vai todo em campos de texto):

| Campo | Valor observado (passo 300661) |
|---|---|
| `formio_comp_id`, `related_component_id` | id do componente do botão (`ej935dj`, `174874`) |
| `stage_id`, `selective_process_id` | `260999`, `20383` |
| `domainParams` | `presencial` |
| `last_place_id`, `last_place_type_id` | `300661`, `1` |
| `button_id` | `3940350` |
| `data` | JSON: lista de `{field_id, field_settings_id, component_id, key, value, rubeus_table, ps_table, type}` |
| `rbParams` | `null` |
| `token`, `substitute_id`, `session_id`, `hostClient`, `contact_id_crm` | sessão do portal + tracking Rubeus (`contact_id_crm` vem do visitante) |

Valores em `data` (300661): 38544 nome, 38545 e-mail, **38546 celular só dígitos** (`99988880002`), 38548 `"223"`, 38564 `"F"`, 38565 `2` (número), 38566 `2005-03-15`, 38606 `false`, 38679 `true`, 38707 `"1"`, 38708 `"4"`. Mesmos campos e valores que o Flow envia ao `/submit` oficial do Rubeus (`test/site-parity.test.js`).

**Portões de acesso (observado):**
- `getApplymentDataByStep/300663` com token novo (nenhum passo concluído) → **HTTP 403** `{"success":false,"data":"Não é possível acessar esse passo"}`. O servidor só libera o passo N+1 depois que o `button-click` do passo N é persistido; abrir `/presencial/passo/300663` direto no navegador redireciona para a raiz.
- A consulta de cursos/turnos (`RB.PS.IM.006`, TOTVS) depende do IDPS gravado no passo 1: sem o `button-click` real do passo 1 o `query_data` volta `"Nada encontrado na base TOTVS"`. Ou seja, as opções de curso/turno **não podem ser pré-carregadas** antes de gravar os dados básicos — é a ordem que o Flow já segue.

**Correções ao mapeamento de 09/11/2026 (`MAPEAMENTO-VESTIBULAR-OFICIAL.md`):**
- "Turno não existe no Flow": **incorreto**. O Flow tem `buscar_turnos` (turno por curso, `CODOFERTA` vindo do `data-source`).
- Celular formatado no Flow: **desatualizado**. `formatBrazilianPhone` devolve só dígitos, como o site.
- "Como você ficou sabendo" vazio no CRM: ocorreu **também na inscrição feita pelo site oficial**, portanto não é defeito do Flow. O Flow envia 319427 = código `01`–`10` (e 319428 só quando `10`). Se o CRM exibe esse dado em outro campo/tela é **PENDENTE** (exige acesso ao CRM).

## 7. Inscrição real de teste e percurso de todos os botões (10/11/2026)

Identidade: "Helena Ribeiro Duarte Teste" (CPF sintético válido, e-mail `@example.com`). Resultado: **applyment_id 14163942**, person_id 10047323, contato CRM 606230, oferta ADS `1-450` / turno `6` / `1-223-493`, IDEXECPROVA `9F68559498`, execução/avaliação 330, questão 65711. Tokens e hashes não foram gravados.

### Passos 2 e 3 — `button-click` real (multipart, mesmos campos de controle da seção 6)

| Passo | `button_id` | `last_place_id` | Campos em `data` | Resposta |
|---|---|---|---|---|
| 300662 Curso | `3940360` | 300662 | 38547=`6`, 38552=`1-223-493`, 38553=`493`, 38610/38611/38612=`1`, 38627=`1-450` | `place_id` 300663, mesmo `applyment_id` |
| 300663 Concluir | `3940366` | 300663 | 38567 CPF só dígitos, 38575=`F`, 38609=`""` (oculto), 38780=`10`, 251544=`Sim`, **319427=`01`** | redireciona a `seletivo.unibalsas.edu.br/obrigado-3` |

- Opções de curso/turno: `getApplymentDataByStep/300662` → `query[RB.PS.IM.006].query_data` (11 ofertas, cada uma com `CODCURSO`, `CODTURNO`, `CODOFERTA`, `IDAREAINTERESSE`, `CODCOLIGADA`, `CODFILIAL`, `CODTIPOCURSO`). Com um só turno, o site preenche o turno sozinho.
- Passo 3: nacionalidade vem de `RB.PS.IM.010` (`10` = Brasileira); origem de `RB.PS.IM.043` (`01`–`10`, idênticos a `ORIGENS_PADRAO`). **O site envia 319427 = `01`**: o Flow envia o mesmo campo e valor (`test/site-parity.test.js`). A diferença só está no campo oculto 38609 vazio, que o Flow omite.
- Persistência: portal → **Inscrição: Concluída**, **Prova online: Prova disponível**.

### Portal do candidato (`/presencial/portal-inscrito`) — todos os botões

| Botão | Efeito observado |
|---|---|
| Detalhes da inscrição | recolhe/expande os dados (curso, modalidade, campus, forma de ingresso) |
| Editar | `/processo/20383/pagina/433`: troca curso/turno ("só se ainda não aprovado"). "Atualizar" sem mudança **não envia nada**; "Portal do candidato" volta |
| Nova inscrição | `/presencial` já logado, lista de processos; nada é criado até "Iniciar inscrição" |
| Menu do usuário: Portal do inscrito / **Meus dados** / Sair | Meus dados = `/pagina/432` (nome, CPF, e-mail, nascimento, celular, telefone residencial, gênero); "Atualizar" envia `button-click` `231861` com 38544–38546, 38564–38567, 38606, 38671 (telefone residencial). Sair volta a `/presencial` deslogado |
| Realizar prova | `/passo/300664` → "Iniciar prova" → `avaliacao.apprubeus.com.br/execucao/inicio/{chave}/606230/926/{IDEXECPROVA}` |

### Plataforma de avaliação — todos os botões

1. **Iniciar avaliação**: `POST create/` (`chave`, `crm_contato_id`, `crm_curso_id`, `crm_processoseletivo_id:null`, `IDEXECPROVA`, `codUsuarioPS:null`), `GET consulta/{token}`, `GET configuracao/`. Cronômetro 02:00:00 começa aqui.
2. **Salvar e continuar mais tarde**: `POST salve/` com `finalizada:0`, `salvar:1`, `salvarEstadoAtual:1`, `tempoUsado` em minutos → página `/execucao/salvar` com "Portal do Candidato" e "Continuar avaliação".
3. **Continuar avaliação**: volta à tela inicial; "Iniciar avaliação" de novo reaproveita a execução, **restaura o texto salvo** e o cronômetro continua do tempo já usado (não reinicia).
4. **Finalizar** (habilitado só com resposta): `POST salve/` com `finalizada:1` (+ `salvar:1`, `salvarEstadoAtual:1`, `finalizada_automaticamente:0`) → `/execucao/concluir`: "Nossa equipe já iniciou a sua correção…". Se reprovado, o candidato poderá "Realizar a avaliação mais uma vez".
5. **Portal do Candidato** → portal: **Prova online: Aguardando correção** e novo botão **Ver informações** → `/passo/300664` com "Você realizou a sua prova. Em breve o resultado estará disponível." (mesmo texto que o Flow exibe).

Comparação com o Flow: o `avaliacao.send` monta o mesmo `salve` final. O Flow **não oferece rascunho** ("salvar e continuar depois"): o candidato só envia a redação final. Isto é diferença de canal, não defeito.

### Etapa assíncrona (correção da redação) — estado real
Envio realizado → recebimento confirmado (`salve` com `finalizada:1` e tela `/execucao/concluir`) → **análise pendente** (portal: "Aguardando correção"). A aprovação é manual da equipe; não há webhook nem polling visível ao candidato: o portal só muda quando a equipe corrige (a correção de 06/11 liberou o status `38623=4` e as etapas seguintes). **Não foi forçada nenhuma transição.** As etapas posteriores (responsável financeiro, endereço, identidade, documentos, contrato, pagamento) continuam inacessíveis para esta inscrição até a aprovação.

## 8. Após a aprovação da redação — login, resp. financeiro, pré-matrícula e documentos (10/11/2026)

Mesma inscrição de teste (Helena, applyment 14163942, `external_code` 20081). Tokens e sessões não registrados.

### Login no portal
`POST /api/applyment/login-portal` — `{domain:"vestibular.unibalsas.edu.br/presencial", user_data:{token_captcha:"", typeLogin:<CPF ou e-mail>, dataNascimento:"DDMMAAAA"}, token, substitute_id, session_id}` → `{success:true, data:{person_id, applyment_id, session_id}}`. Não pediu captcha (`token_captcha` vazio). Em seguida: `check-login` (traz `external_code` e `person_name`), `settings/selective-process`, `person-applyment` (lista de processos do candidato) e `register-portal-data` (etapas com `feedback.complementary_text`).

### Situação após a aprovação
`register-portal-data`: 260999 Concluída · 261000 **Aprovado** · 261012 Pendente (300676) · 261002 "Informe o responsável" (300666, 300667).

### Passos e envios reais (`button-click`, multipart)
| Passo | Botão | Campos em `data` | Resposta |
|---|---|---|---|
| 300676 Resp. financeiro | `3940483` | 38608=`20081` (CODUSUARIOPS = `external_code`), 232542=`Eu` | `place_type_id` 5 (volta ao portal); 261012 → Concluído |
| 300666 Endereço | `3940407` | 38568 CEP só dígitos, 38569 rua, 38570 número, 38571 bairro, 38572 complemento (`""`), 38573 UF, 38574 cidade, 38641 estado natal (`MA`), 38640 cidade natal **código TOTVS** (`01400` = Balsas), **38704=`21` oculto (idade)** | `place_id` 300667 |
| 300667 Identidade | `3940411` | 38642 RG **como digitado** (`123456-X`), 38643 órgão, 38644 UF (`MA`), 38645 cor/raça (`8` Parda), 38646 estado civil (`S`), 38680 ano (`2023`, lista 1995–2027), 38699 escola (`""`), 38593 TOKENPROVA (oculto) | `place_type_id` 5 + `fields_updated` (abaixo); 261002 → Concluída |

- CEP: `POST /api/applyment/cep` `{component_id:3940404, cep:"65800000"}` → `{address, district, city:"Balsas", state:"MA", enable_edit_city:0, enable_edit_state:0, ...ids dos campos}`. Cidade e UF ficam travadas quando o CEP as devolve.
- Cidade natal depende do estado natal (lista `RB.PS.IM.009`, 5.568 cidades, filtrada pelo estado escolhido).
- Identidade: listas `RB.PS.IM.033` (27 UF), `.028` (7 cor/raça), `.034` (9 estado civil), `.040` (1.461 escolas).
- **Integração com o RM ao concluir a Identidade** — `fields_updated`: 38647=`37896`, 54725=`0`, **38651=`27.1.23603`** (chave da inscrição no RM, usada na `CHAVERM` dos documentos), 38652=`91270`, **38648=`C015913`** (provável RA), 38649=`1`, 38668=`2026-11-10T00:00:00`.
- Novas etapas: 261006 Documentos matrícula (300671) **Pendentes** · 261004 Contrato (300669) **Aguardando documentação** · 261007 Matriculado **Existem pendências**.

### Documentos de matrícula (300671) — contrato real do upload
Lista: 7 documentos com `CODTIPODOCUMENTO` e `CHAVERM` = `1;79;27.1.23603;<cod>`: 1 Identidade, 2 CPF, **5 Histórico\***, **8 Certificado\***, 15 Comprovante de residência, 16 Docs do responsável financeiro, **46 Declaração de conclusão\*** (\* obrigatórios). Site: PNG/JPG/JPEG/PDF até **5 MB**; análise em até 48 h úteis.

Envio (botão `3940449` "Enviar", stage 261006), multipart:
- parte **`file_0`** = o arquivo **binário** (`application/pdf`);
- `data` = `[{field_id:38733, key:38733, component_id:3940446, type:"upload", field_settings_id:null, value:[ …7 itens… ]}]`, cada item `{CODIGO, title, STATUSENVIO:null, PATHARQUIVO:null, CHAVERM, ADICIONAL:null, ADICIONAL2:null, files:[], value:null}`; o documento enviado leva **`files:[{}]` e `value:["file_0"]`** (referência à parte binária);
- demais campos de controle iguais aos outros passos.

Resposta: `success:true`, `place_type_id` 5. Portal do passo: **"COMPROVANTE DE RESIDÊNCIA — EM ANÁLISE"** (arquivo renomeado para `COMPROVANTE DE RESIDÊNCIA.pdf`). Envio parcial é aceito; a etapa só sai de "Pendentes" com os obrigatórios. Arquivo usado: PDF de 1 página "DOCUMENTO DE TESTE - NAO VALIDO - Teste".

### Comparação com o Flow (`api/matricula.js`)
| Ponto | Site | Flow | Situação |
|---|---|---|---|
| Upload | binário em `file_0` + `value:["file_0"]` no item do campo 38733 | arquivo **dentro do JSON** (`formio`, `lista`, `dataurl`, `base64`, linha 134) | ❌ causa provável dos HTTP 500 da 1.6.12–1.6.15 |
| Limite | 5 MB | 740 KB | ℹ️ limite do Flow |
| RG | como digitado (`123456-X`) | só dígitos | ❌ perde letra/dígito X |
| Idade 38704 | enviada (oculta) | — | ⚠️ conferir se o `/submit` oficial calcula sozinho |
| Ano de conclusão | lista 1995–2027 | texto 1950–ano atual | ⚠️ |

### Etapa assíncrona seguinte
Contrato (300669) só libera depois dos 3 obrigatórios **e** da análise da equipe (até 48 h). Para seguir: enviar Histórico, Certificado e Declaração de teste e aguardar a análise — ou a equipe validar manualmente, como foi feito com a redação.

### Atualização — envio em lote (10/11/2026, 16h)
O usuário anexou arquivos em Identidade (1), CPF (2) e Docs do responsável financeiro (16) e eles foram enviados num único "Enviar" (mesmo botão `3940449`). Resultado no passo 300671: os três **EM ANÁLISE** (renomeados para `CARTEIRA DE IDENTIDADE.pdf` e `CPF.pdf`; o do responsável aparece sem nome de arquivo). Este envio não foi capturado (a página recarregou e perdeu o gancho); presume-se `file_0…file_n` + `value:["file_k"]` por item, **a confirmar** no próximo envio. Pendentes: Histórico\*, Certificado\*, Declaração\* — o Contrato (300669) segue "Aguardando documentação".

## 9. Contrato (stage 261004, passo 300669) — 10/11/2026

- **Acesso:** o portal mostra "Aguardando documentação", mas `validate-access` com `step_id:300669` responde `{"success":true}` e `getApplymentDataByStep/300669` devolve o passo completo. Abrindo `/presencial/passo/300669` direto, a tela carrega. **O bloqueio é só visual no portal**, não na API.
- **Fluxo real:** não há aceite dentro do portal. O texto da etapa orienta: baixar o contrato, **assinar digitalmente pelo GOV.BR** e enviar por e-mail à central de matrícula (endereço exibido na página); dúvidas pelo WhatsApp da instituição. A matrícula segue depois que a equipe recebe o contrato assinado (etapa manual, fora do sistema).
- **Botão "Clique aqui para fazer o download do contrato"** = `button-click` `3940424` (componente 174890), `stage_id` 261004, com `data`: 38635 aceite (`false`), 38636 data de assinatura (`""`), 52136 IP de aceite (preenchido pelo navegador com o IP público de quem clica — não registrado aqui).
  - Resposta: `place_id` 765, `place_type_id` **6** (popup) e `report:{secret_hash:<hash>+<applyment_id>, report_view_id:3, access_report:<JWT de 10 min emitido por admin.portal.apprbs.com.br/api>}`.
  - Depois: `POST /api/applyment/popup` `{popup_id:765, stage:{stage_id:261004}, token…}` → janela "Contrato gerado 🎉 Parabéns, seu contrato foi gerado com sucesso!".
  - **Não confirmado:** a URL final do PDF (gerada a partir do `access_report`). Nenhum `window.open` nem link apareceu na captura.
- **Situação da Helena:** contrato gerado (popup confirmou), **nada assinado nem enviado**. Documentos: 4 em análise; Histórico, Certificado e Declaração ainda pendentes.
- **Para o Flow:** a etapa não tem envio a fazer pelo sistema. O Flow pode (a) gerar o contrato pelo mesmo botão e (b) orientar a assinatura no GOV.BR e o envio por e-mail. Entregar o PDF dentro do WhatsApp depende de descobrir a URL do relatório.

## 10. Documentos obrigatórios — envio com vários arquivos (10/11/2026)

Arquivos anexados pelo usuário em Histórico (5), Certificado (8) e Declaração (46); um único "Enviar" (`3940449`). Captura confirmada:
- partes binárias **`file_0`, `file_1`, `file_2`** (uma por documento, na ordem da lista);
- no campo 38733: `5 → value:["file_0"]`, `8 → value:["file_1"]`, `46 → value:["file_2"]`, cada um com `files:[{}]`; os demais itens vão com `value:null`.
- Resposta `success:true`, `place_type_id` 5.
- **Portal:** "Documentos matrícula" passou de **Pendentes → Em análise** (os 7 enviados). Contrato segue "Aguardando documentação" e Matriculado "Existem pendências": dependem da análise humana (até 48 h úteis).

## 11. Documentos aprovados e entrega do contrato (10/11/2026)

- Após a análise da equipe, o portal passou a: **Documentos matrícula: Entregues** · **Contrato: Pendente** (botão Verificar) · Matriculado: Existem pendências.
- Login novamente pelo e-mail de teste (a sessão do portal expira; `clear-session` + `login-portal` aparecem no tráfego).
- "Clique aqui para fazer o download do contrato" repete o fluxo da seção 9 (`button-click` 3940424 → popup 765 "Contrato gerado").
- **Onde está o PDF:** na resposta do `POST /api/applyment/popup` (≈384 KB), em `data.applicantData[]` — o item com **`field_id` 52138** traz o contrato em **base64** (`JVBERi0x…` = `%PDF-1.4`, ≈253 KB). Nenhuma URL de download nem `window.open`: o próprio site monta o arquivo a partir desse base64. (O mesmo `applicantData` traz todos os campos da inscrição.)
- **Para o Flow:** depois do `button-click` 3940424, ler o campo 52138 da inscrição (pela resposta do popup ou pelo `/form` do Rubeus, se ele expuser o campo) e entregar o PDF ao candidato pelo WhatsApp como documento, com a orientação de assinar no GOV.BR e enviar por e-mail à central de matrícula.
- O arquivo não foi salvo nesta investigação.

## 12. Outros processos — login e situação (10/11/2026)

Logins feitos pela própria API do portal (`settings/` → `login-portal` com CPF só dígitos + data `DDMMAAAA` → `person-applyment` → `register-portal-data`). Identidades de teste fornecidas pelo usuário.

| Processo | applyment | Etapas (`register-portal-data`) |
|---|---|---|
| Transferência 20385 | 14150234 | 261026 Concluída (300692–300694) · **261028 Em análise** (300696 Documentos de inscrição) |
| Portador de Diploma 20384 | 14150338 | 261013 Concluída (300677–300679) · **261015 Pendentes** (300681 Documentos de inscrição) |
| Nota do ENEM 20386 | 14150473 | 261039 Concluída (300707–300709) · **261049 Validando** (300719, validação das notas; campo Status da opção 38623) · **261041 Pendentes** (300711 Documentos de inscrição) |

**Documentos de inscrição (300696 / 300681 / 300711) ≠ documentos de matrícula (300671):** o formulário não usa a lista `CHAVERM` + `file_N`. Ele tem campos ocultos "Upload - Base64 - Inscrição", "Upload - Tipo de documento - Inscrição", "Upload - Nome do arquivo - Inscrição", `NUMEROINSCRICAO`, `IDPS`, `CODCOLIGADA`, `CODUSUARIOPS` e ações "Ações TOTVS / Salvar Dados" — ou seja, grava em base64 no RM, o mesmo modelo da API da UniBalsas (`/blip/documents`) que o Flow já usa em `api/documentos.js`. Caleb (Transferência) tem `STATUSENVIO=1` → documentos enviados e "Em análise".

**Não feito nesta rodada:** envio de documentos de Matheus e Laura (precisam de arquivos), captura do envio real dessas etapas e o próximo passo do ENEM depois de "Validando" (depende da equipe).

### 12.1 Envio real — Portador de Diploma (Matheus, 300681) — corrige a seção 12
- Documentos: **10 Diploma de graduação\*** (obrigatório), 17 Histórico da graduação, 26 Certidão de conclusão – graduação. Curso da inscrição: Direito – Noturno.
- Envio simulado com um PDF de teste (417 B) no Diploma. `button-click` **3940542**, componente 174882, stage 261015. **Mesmo formato da matrícula:** parte binária `file_0`; campo **38633** (componente 3940539, `type:"upload"`) com a lista `{CODIGO, title, STATUSENVIO, PATHARQUIVO, CHAVERM:null, ADICIONAL, ADICIONAL2, files, value}`; o Diploma vai com `files:[{}]`, `value:["file_0"]`.
- Resposta `success:true`, `place_type_id` 5. Passo 300681: **DIPLOMA DE GRADUAÇÃO — EM ANÁLISE** (renomeado `DIPLOMA DE GRADUAÇÃO.pdf`). Logo após o envio o card do portal ainda mostrava "Documentos inscrição: Pendentes".
- Os campos ocultos "Upload - Base64/Tipo/Nome - Inscrição" + "Ações TOTVS / Salvar Dados" são a gravação **do lado do servidor** (o navegador envia o binário; o Rubeus converte e grava no RM). Ou seja, para o Flow os dois caminhos são válidos: o do navegador (multipart `file_0`) e o da API da UniBalsas (base64).
- **Segundo envio (Matheus):** arquivos anexados pelo usuário em Histórico (17) e Certidão (26). Partes `file_0` e `file_1` — **a numeração recomeça a cada envio**. O Diploma já enviado segue na lista com `value:null` e `STATUSENVIO:1` (preservado, não reenviado). Resposta `success:true`. Portal: **Documentos inscrição: Em análise** (o botão Verificar some enquanto está em análise).

## 13. Situação em 12/11/2026 e etapa de pagamento

| Candidato | Etapas (`register-portal-data`) |
|---|---|
| Helena (Vestibular) | … Documentos matrícula **Entregues** · Contrato **Assinado** · **261005 Taxa de matrícula (300670)** (sem texto de status) · Matriculado: Existem pendências |
| Caleb (Transferência) | Documentos de inscrição **Obrigatório entregues** · 261038 Seleção resp. financeiro **Pendente** (300706) · 261029 Pré-matrícula "Informe o responsável" (300697, 300698) |
| Matheus (Portador) | Documentos **Obrigatórios entregues** · 261025 resp. financeiro **Pendente** (300691) · 261016 Pré-matrícula (300682, 300683) |
| Laura (ENEM) | Notas **Aprovado** (261049) · 261041 Documentos de inscrição (sem texto) · 261052 resp. financeiro **Pendente** (300722) · 261042 Pré-matrícula (300712, 300713) |

Nos três processos de ingresso, depois dos documentos de inscrição vem a mesma sequência do Vestibular: "Quem é seu responsável financeiro?" (botão 2461077, campo CODUSUARIOPS) → Pré-matrícula (endereço + identidade).

### Taxa de matrícula (stage 261005, passo 300670) — só leitura
- `validate-access` libera o passo. Campos: **38702 Meio de pagamento** (rádio, obrigatório, opções `C` = Cartão de crédito — padrão — e `P` = Pix), ocultos 38656 IDBOLETO, 53443 valor com desconto Pix, 38661 valor com desconto do boleto formatado, 38658 taxa em centavos (todos vazios antes do clique), "Valor do Pagamento".
- Botões: **"Realizar pagamento"** e **"Gerar boleto"**; popups **1016** e **764** (no mapeamento de 06/11: Pix/cartão/boleto → popups 1016/577/764).
- **Nenhum botão de pagamento foi clicado.** Próximo passo depende de saber qual é o meio de teste sem cobrança real.

## 14. Resp. financeiro e pré-matrícula — Transferência, Portador e ENEM (12/11/2026)

Login feito pela API com o próprio `localStorage.token` do portal (`login-portal` com esse token → a interface abre logada; útil para testes). Mesmos dados fictícios de endereço (CEP 65800-000) e identidade.

| | Transferência (Caleb) | Portador (Matheus) | ENEM (Laura) | Vestibular (Helena, ref.) |
|---|---|---|---|---|
| Resp. financeiro — botão | 3940750 | 3940617 | 3940896 | 3940483 |
| Campos enviados | 38608 + 232542 | **só 232542** | **só 232542** | 38608 + 232542 |
| Endereço — botão / passo | 3940680 / 300697 | 3940547 / 300682 | 3940815 / 300712 | 3940407 / 300666 |
| Idade 38704 | 44 | 47 | 51 | 21 |
| Identidade — botão / passo | 3940684 / 300698 | 3940551 / 300683 | 3940819 / 300713 | 3940411 / 300667 |
| Campo extra na identidade | — | — | **53017** (vazio) | — |
| RA gerado (38651) | 27.1.23835 | 27.1.23843 | 27.1.23850 | 27.1.23603 |
| Novas etapas | Docs matrícula 300702 Pendentes · Contrato 300700 · Matriculado 261034 | Docs matrícula 300687 · Contrato 300685 · Matriculado 261021 | Docs matrícula 300717 · Contrato 300715 | — |

Conclusões:
- **38704 é a idade** (confirmado com 4 candidatos: 21, 44, 47, 51) — calculada pelo site a partir do nascimento.
- Campos e valores do endereço/identidade são iguais nos 4 processos; mudam os IDs de passo, stage e botão → o Flow deve continuar lendo botões e campos do formulário (como já faz), sem fixar IDs.
- Nos ingressos diretos o resp. financeiro não envia o CODUSUARIOPS (38608) em Portador e ENEM.
- Na Laura (ENEM), "Documentos inscrição" e "Resp. financeiro" ficaram sem texto de status depois de concluídos (o `complementary_text` vem vazio).

## 15. Documentos de matrícula dos ingressos e pagamento (12/11/2026)

Envio de um PDF de teste ("DOCUMENTO DE TESTE - NAO VALIDO - Teste") nos 7 documentos de matrícula de cada candidato, a pedido do usuário. Todos `success:true`, 7 partes `file_0…file_6`, campo **38733** (mesmo ID nos 4 processos):

| Candidato | Passo | Botão | Componente | CHAVERM do 1º item |
|---|---|---|---|---|
| Caleb (Transferência) | 300702 | 3940722 | 3940719 | `1;79;27.1.23835;1` |
| Matheus (Portador) | 300687 | 3940589 | 3940586 | `1;79;27.1.23843;1` |
| Laura (ENEM, Biomedicina) | 300717 | 3940857 | 3940854 | `1;**80**;27.1.23850;1` |
| Helena (Vestibular, ref.) | 300671 | 3940449 | 3940446 | `1;79;27.1.23603;1` |

- Lista de documentos idêntica nos 4 processos (códigos 1, 2, 5\*, 8\*, 15, 16, 46\*).
- **O 2º elemento da CHAVERM não é o código do aluno**: é `79` para três pessoas diferentes e `80` para a Laura (Biomedicina, `CODTIPOCURSO` 8 na lista de ofertas). Hipótese: identificador ligado ao tipo de curso/habilitação — **a confirmar com a T.I.**
- **Troca de sessão:** chamar `login-portal` com outro CPF no mesmo token **nem sempre troca a pessoa** (Matheus → Laura manteve Matheus). O site chama `clear-session` antes; com `clear-session` + `login-portal` a troca funcionou. Importante para o Flow se ele reaproveitar token entre candidatos.
- Com a sessão de um candidato é possível abrir a URL de passo de **outro processo** (`/passo/300717` com a sessão do Matheus mostrou "Nota do ENEM – Documentos matrícula", sem os campos). Não houve envio nesse estado.

### Pagamento — Helena (300670)
Tela: "Estamos finalizando! Para concluir a sua matrícula, realize o seu pagamento", "Valor a pagar" (sem valor exibido antes da escolha), rádio 38702 (Cartão de crédito marcado por padrão / Pix) e botão **"Realizar pagamento"**. **O clique não foi executado** — a ação foi bloqueada pela proteção de transações reais do ambiente de automação. A geração da cobrança (Pix ou cartão) e o que o site retorna ficam **PENDENTES**, para o usuário clicar manualmente; depois disso dá para ler e documentar o resultado só em leitura.
- **Clique feito pelo usuário (Pix), 2 tentativas:** `button-click` **3940437** com `stage_id:null`, `last_place_id:null`, `last_place_type_id:null` e `data`: 38702=`P`, 38656 (IDBOLETO)=`""`, 38658 (taxa em centavos)=`""`, 38661 (valor boleto)=`""`, 53443 (valor Pix)=`""`. Resposta das duas: **`{"success":false,"data":"Não foi possível realizar o pagamento com o PIX!"}`** (HTTP 200). Nenhum popup, nenhum código Pix gerado.
- Leitura: a tela já mostrava "Valor a pagar" vazio e os campos de valor/taxa estão vazios no envio → **o valor da taxa não foi calculado para esta inscrição**, e a geração do Pix falha. Provável configuração (taxa da oferta/RA de teste no RM ou integração de pagamento). **BLOQUEADO** até a equipe verificar; não houve nova tentativa.
- Para o Flow: tratar `success:false` com a mensagem do servidor e **não** mostrar código Pix nem confirmar pagamento sem `success:true`.
