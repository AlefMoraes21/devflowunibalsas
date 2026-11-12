# Mapa da jornada — UniBalsas 2027/1 (site × Flow)

Consolidado de 12/11/2026. Detalhes, payloads e evidências: `ENGENHARIA-REVERSA-VESTIBULAR-2027.md` (seções indicadas como §). Testes reais com 4 candidatos fictícios: Helena (Vestibular 20383), Caleb (Transferência 20385), Matheus (Portador 20384), Laura (ENEM 20386).

Legenda de situação do Flow: ✅ igual ao site · ⚠️ diferença a corrigir · ❌ não implementado · 🔒 bloqueado/externo.

## 1. Contrato comum a todas as etapas do site

- Host `vestibular.unibalsas.edu.br`, API `/api/applyment/*`, sempre `POST`.
- Sessão: `settings/` devolve o `token` (fica em `localStorage.token`). `login-portal` associa a pessoa ao token; trocar de pessoa exige `clear-session` antes (§15).
- Leitura de passo: `getApplymentDataByStep/{passo}` `{execute_stage_query, token, process_id}`; acesso controlado por `validate-access` (403 "Não é possível acessar esse passo" se o passo anterior não foi gravado — §6). Exceção: o Contrato abre pela API mesmo com o portal mostrando "Aguardando documentação" (§9).
- Gravação: `button-click` em **multipart**: `formio_comp_id, stage_id, selective_process_id, domainParams, last_place_id, last_place_type_id, button_id, related_component_id, data (JSON), rbParams, token, substitute_id, session_id, hostClient, contact_id_crm` + `file_N` quando há upload (§6, §8).
- Resposta: `place_id` + `place_type_id` (1 = próximo passo, 5 = volta ao portal, 6 = popup) e, às vezes, `fields_updated` (valores calculados pelo servidor/RM).
- Situação das etapas: `register-portal-data` → `stages[].feedback.complementary_text`.
- O Flow usa a API oficial do Rubeus (`admin.portal.apprbs.com.br`: `/form`, `/submit`, `/data-source`), não o `button-click`; a paridade é por campo e valor.

## 2. Etapas

| # | Etapa (Vestibular) | Passo / botão | O que o site envia | Flow | § |
|---|---|---|---|---|---|
| A | Escolha do processo | `/presencial` → `start-applyment` | process_id 20383/20384/20385/20386 | ✅ `ESCOLHA_PROCESSO` | 6 |
| B | Dados básicos | 300661 / 3940350 | 38544 nome, 38545 e-mail, 38546 celular **só dígitos**, 38548 IDPS `223`, 38564 `M/F`, 38565 `1/2`, 38566 `AAAA-MM-DD`, 38606, 38679 `true`, 38707 `1`, 38708 `4` | ✅ (`site-parity.test.js`) | 6 |
| C | Curso de interesse | 300662 / 3940360 | 38627 curso, 38547 turno, 38552 CODOFERTA, 38553 área, 38610/38611/38612. Opções em `query RB.PS.IM.006` (11 ofertas) — só existem **depois** de gravar o passo B | ✅ (`buscar_turnos`) | 6, 7 |
| D | Estamos quase lá (Concluir) | 300663 / 3940366 | 38567 CPF dígitos, 38575 `T/F`, 38780 `10`, 251544 `Sim/Não`, 319427 origem `01–10` (+ 38609 vazio) | ✅ (`site-parity.test.js`) · 🔒 origem aparece vazia no CRM (também pelo site) | 7 |
| — | Confirmação | `seletivo.unibalsas.edu.br/obrigado-3` | — | ✅ `CONFIRMACAO` | 7 |
| E | Login no portal | `login-portal` | `typeLogin` CPF **ou e-mail** + `dataNascimento` `DDMMAAAA`, `token_captcha` vazio | ✅ "Já sou inscrito" (CPF + nascimento) | 8 |
| F | Prova online (Vestibular) | 300664 / 3940382 → `avaliacao.apprubeus.com.br` | `create/` → `consulta/` → `salve/` (`finalizada:0` rascunho, `finalizada:1` final) | ✅ envio final · ❌ rascunho ("salvar e continuar") | 3, 7 |
| — | Correção da redação | assíncrona, manual | portal "Aguardando correção" → "Aprovado" | ✅ `aguardando_resultado` | 7, 8 |
| G | Documentos de inscrição (Transf./Portador/ENEM) | 300696 / 300681 (3940542) / 300711 | multipart `file_N` + campo 38633 (lista com `value:["file_N"]`, `CHAVERM:null`); servidor converte para base64 e grava no RM | ✅ via API UniBalsas (base64) | 12.1 |
| — | Validação das notas (ENEM) | 300719 | manual ("Validando" → "Aprovado") | ✅ acompanhamento | 12 |
| H | Responsável financeiro | 300676 / 3940483 (Transf. 3940750, Portador 3940617, ENEM 3940896) | 232542 `Eu/Outro` (+ 38608 CODUSUARIOPS só em Vestibular e Transferência) | ✅ `RESP_FINANCEIRO` | 8, 14 |
| I | Endereço | 300666 / 3940407 (Transf. 3940680, Portador 3940547, ENEM 3940815) | **38568 CEP dígitos**, 38569–38574, 38640 cidade natal (código TOTVS), 38641 UF natal, **38704 idade** | ⚠️ **Flow não envia CEP (38568) nem idade (38704)** — `SPEC.ENDERECO` em `api/matricula.js` | 8, 14 |
| J | Identidade | 300667 / 3940411 (Transf. 3940684, Portador 3940551, ENEM 3940819) | 38642 RG **como digitado**, 38643, 38644, 38645, 38646, 38680 ano (lista 1995–2027, **opcional**), 38699 escola (opcional), 38593 oculto; ENEM +53017. Ao concluir, o RM gera RA (38651) e outros via `fields_updated` | ⚠️ RG perde a letra; ano de conclusão é **obrigatório** e livre (1950+) no Flow | 8, 14 |
| K | Documentos de matrícula | 300671 / 3940449 (Transf. 3940722, Portador 3940589, ENEM 3940857) | multipart `file_N` + campo **38733** com 7 itens `{CODIGO, CHAVERM "1;79|80;<RA>;<cod>", files, value:["file_N"]}`; já enviados vão com `value:null`, `STATUSENVIO:1`; numeração reinicia por envio | ✅ via API UniBalsas (base64; fica fora do controle da etapa — decisão aceita) · ⚠️ limite 740 KB (API 1 MiB) | 8, 10, 15 |
| L | Contrato | 300669 / 3940424 | gera o contrato (38635 aceite `false`, 38636 data, 52136 IP); popup 765; **PDF em base64 no campo 52138** da resposta de `/popup`. Assinatura: GOV.BR + e-mail à central de matrícula | ❌ Flow manda "registrar o aceite no Portal" (texto incorreto) e não entrega o PDF | 9, 11 |
| M | Taxa de matrícula | 300670 / 3940437 | 38702 `C` cartão / `P` Pix (+ botão "Gerar boleto"); ocultos 38656, 38658, 38661, 53443 | ❌ abre o portal · 🔒 Pix falhou: "Não foi possível realizar o pagamento com o PIX!" (taxa sem valor) | 13, 15 |
| N | Matriculado | 261007 | "Existem pendências" | — | 13 |

## 3. O que corrigir no Flow (por prioridade)

| Prioridade | Item | Onde |
|---|---|---|
| P1 | Enviar **CEP (38568)** no endereço e no endereço do responsável | `api/matricula.js` `SPEC.ENDERECO` / `RESP_DADOS` |
| P1 | CPF do cliente não pode sobrescrever o CPF do estado selado (Flow roda no Blip, sem assinatura da Meta) | `api/flow.js`, `api/matricula.js` |
| P1 | Texto e fluxo do **Contrato**: gerar pelo botão, entregar o PDF (campo 52138) e orientar GOV.BR + e-mail | `api/matricula.js` `PORTAL_TEXT` |
| P2 | Enviar **idade (38704)** — confirmar se o `/submit` oficial calcula sozinho | `api/matricula.js` |
| P2 | RG como digitado (o RM aceita letra) | `api/matricula.js` linha do `set("rg", …)` |
| P2 | Ano de conclusão opcional e em lista 1995–ano atual+1, como no site | `api/matricula.js`, `flow-waba.json` |
| P2 | Texto de documentos: "5 MB por arquivo" (o Flow diz "no total") | `PORTAL_TEXT` |
| P2 | Pagamento: tratar `success:false` com a mensagem do servidor; nunca confirmar sem `success:true` | futuro |

## 4. Pendências externas

- "Como você ficou sabendo" (319427) vazio no CRM — Rubeus.
- `/rm/documents` vazio no IDPS 223 — T.I.
- 2º elemento da CHAVERM (`79`/`80`) não é o código do aluno — T.I.
- Taxa de matrícula sem valor para a Helena (Pix falha) — equipe financeira.
- Limite de 1 MiB do corpo na API UniBalsas (≈768 KB de arquivo) — T.I.
- Contrato, pagamento e matrícula de Caleb, Matheus e Laura — aguardando análise dos documentos.
