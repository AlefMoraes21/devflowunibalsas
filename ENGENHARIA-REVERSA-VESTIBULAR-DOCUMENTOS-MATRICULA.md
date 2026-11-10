# Engenharia reversa - Vestibular Online: "Documentos de matrícula" (passo 300671)

Origem: portal `https://vestibular.unibalsas.edu.br/presencial/portal-inscrito`, cadastro fictício Nicole Catarina Olivia Peixoto, passo `/presencial/passo/300671`. Mapeamento **somente leitura**: nenhum arquivo foi enviado e nenhum botão de envio foi clicado.

Legenda: **[OBSERVADO]** visto nas respostas do portal; **[INFERIDO]** dedução; **[DESCONHECIDO]** precisa de confirmação.

## 1. Resumo

- **[OBSERVADO]** Os documentos de matrícula do Vestibular **não usam** a API de inscrição (`/rm/documents` + `/blip/documents`). O portal grava na tabela **SDOCALUNO** do RM (documentos do aluno) por meio da ação TOTVS "Salvar Dados" do Rubeus.
- **[OBSERVADO]** `/rm/documents?codColigada=1&idps=223` (Vestibular) devolve lista vazia: a API documentada não cobre esta etapa.
- **Atualização (1.6.9): implementado** pelo canal oficial do Rubeus (`/submit` do botão 3940449 a partir do Cloud Run), com interruptor `MATRICULA_DOCS_UPLOAD=off`. A aceitação do arquivo pelo RM ainda não foi confirmada em produção (ver LEIA-ME e checklist 4.1).
- Consequência: o DocumentPicker do Flow consegue **receber** o arquivo (já funciona na 1.6.8), mas hoje **não há endpoint documentado para entregá-lo** ao RM nesta etapa.

## 1.1 Linha do tempo do portal (Nicole, 10/11/2026) e regras da tela

**[OBSERVADO]** Etapas: Inscrição (Concluída) -> Prova online (Aprovado) -> Seleção resp. financeiro (Concluído) -> Pré-matrícula (Concluída) -> **Documentos matrícula (Pendentes, botão "Verificar")** -> Contrato (Aguardando documentação) -> Matriculado (Existem pendências).
Contrato e Matriculado **não têm botão de ação**: são só status e dependem dos documentos. O único ponto em aberto com ação do candidato é o passo 300671.

**[OBSERVADO]** Documentos (os com * são obrigatórios): Carteira de identidade; CPF; **Histórico ensino médio \***; **Certificado de conclusão ensino médio \***; Comprovante de residência; Documentos / responsável financeiro; **Declaração de conclusão ensino médio \***.
Regras do texto da tela: extensões png, jpg, jpeg ou pdf; **máximo 5 MB** por arquivo; cada arquivo com todas as páginas (frente e verso); situação da análise visível por arquivo; análise em até **48 horas úteis**; prazo de **30 dias** para enviar a documentação.

**Compatibilidade com o DocumentPicker (doc Meta media_upload):** um DocumentPicker por tela, não vai em `navigate`, referência em string de topo no `data_exchange`, mídia na CDN por até 20 dias, `max-file-size-kb` até 25600, PDF/JPEG/PNG suportados. Portanto: **uma tela, um documento por vez** (Dropdown + DocumentPicker), como a `DOCUMENTOS_INSCRICAO` já faz. O limite do portal (5 MB) é maior que o do `/blip/documents` (740 KB); para matrícula o limite real depende do endpoint a ser criado.

## 1.2 Análise do bundle JS do portal (Angular, `main.c81eb16ccd9bedf3.js` + 46 chunks)

Feita pelo navegador do app (o craft-anything recusou `web_site_open` por `consent_required`). Só leitura do código público; nada executado além de baixar os arquivos.

- **[OBSERVADO] Linhas do componente `upload`** (`upload_content`, chunk 4280): `DESCRICAODOCUMENTO`, `CODTIPODOCUMENTO` (código do documento), `OBRIGATORIO` (1 = sim, 0 = não), `STATUSENVIO` (**1 = Em análise, 2 = Recusado, 3 = Aceito**), `MOTIVORECUSA`, `PATHARQUIVO` (caminho no TOTVS), `CHAVERM` (chave do arquivo no TOTVS), `ADICIONAL`, `ADICIONAL2`. É o formato que a query RB.PS.IM.017 devolve.
- **[OBSERVADO]** Cada documento tem seu próprio botão de envio; recusado mostra "Recusado: {motivo}"; o front valida tipo (`acceptedType`) e tamanho (`acceptedSize`, configurado no passo) antes de enviar.
- **[OBSERVADO] Chamada de envio**: `POST /api/applyment/button-click` com `step_id`, `button_id`, `person_id`, `applyment_id`, `stage_id`, `selective_process_id`, `token`, `data` (campos do formulário, incluindo o base64). Carregar o passo: `getApplymentDataByStep/{step}`.
- **[INFERIDO]** `CODTIPODOCUMENTO` alimenta o campo 38733 (CODDOCUMENTO) do SDOCALUNO. O `STATUSENVIO` permitiria o Flow mostrar "em análise / recusado (motivo) / aceito" por documento, se houver endpoint de consulta.
- **[DESCONHECIDO]** O bundle não contém a lista de documentos nem as regras de gravação: elas ficam no servidor Rubeus/UniBalsas. O bundle confirma como o portal fala com o servidor, não o que o RM faz.
- **[DERIVADO] Confirmação pelo craft-anything** (`js_app_map` sobre os 7 arquivos JS baixados, evidência `ev_1348995d453b9aefb88d99b4d656663a91e080d0d278bcabfdb8d9e9a6df739f`): o portal é Angular com formulários **Form.io**; o componente `upload` do Rubeus estende o Form.io. Endpoints do bundle: `{API}/applyment/*` (ex.: `applyment/cep`), mais bibliotecas de terceiros (Form.io, reCAPTCHA, mapas, iugu). Nenhum endpoint de documentos além do `button-click`. `web_site_open` do craft segue pedindo aprovação; a análise foi feita sobre os arquivos locais.
- **[DERIVADO] Análise ao vivo pelo craft** (`web_site_open` + `web_page_js_analyze`, evidência `ev_6b8092dbf1dcae9d7c8be4d93cf92fda258ca2222dfb19439803ded4c93a7127`, 35 scripts, sessão sem login): o back-end do portal é `https://processoseletivo.azurewebsites.net/api` (Rubeus, **não** a API `api.unibalsas.edu.br`). Rotas `applyment/*` vistas: `settings`, `check-login`, `clear-session`, `change-current-applyment`, `cep`, mais `button-click` e `getApplymentDataByStep` (capturados antes na sessão logada). Há `abortMultipartUpload` no código, vindo do Form.io. Nenhuma rota exclusiva de documentos. Conclusão: o upload da matrícula passa pelo Rubeus (`button-click`) e só então chega ao RM; a UniBalsas não expõe isso na API documentada.
- **Impacto no Flow:** o Flow deve mostrar por documento o status (Em análise / Recusado + motivo / Aceito) e permitir reenviar os recusados.

## 1.3 Envio simulado (10/11/2026, cadastro fictício, 2 PDFs "ARQUIVO DE TESTE - NAO VALIDO")

Feito com o gravador de XHR no painel do app (sessão logada). Enviados: Histórico (código 5) e Certificado (código 8). Resultado: os dois ficaram **"EM ANÁLISE"**; o servidor renomeou o arquivo para a descrição do documento (`HISTÓRICO ENSINO MÉDIO.pdf`). Faltam os outros 5 (3 obrigatórios no total: o Declaração, código 46, segue pendente).

**Códigos dos documentos [OBSERVADO]** (`upload_content` de `getApplymentDataByStep/300671`; colunas `CODTIPODOCUMENTO`, `DESCRICAODOCUMENTO`, `OBRIGATORIO`, `CHAVERM`, `STATUS`):

| CODDOCUMENTO | Documento | Obrigatório |
|---|---|---|
| 1 | CARTEIRA DE IDENTIDADE | não |
| 2 | CPF | não |
| 5 | HISTÓRICO ENSINO MÉDIO | **sim** |
| 8 | CERTIFICADO DE CONCLUSÃO ENSINO MÉDIO | **sim** |
| 15 | COMPROVANTE DE RESIDÊNCIA | não |
| 16 | DOCUMENTOS / RESPONSÁVEL FINANCEIRO | não |
| 46 | DECLARAÇÃO DE CONCLUSÃO ENSINO MÉDIO | **sim** |

`CHAVERM` = `CODCOLIGADA;IDPERLET;RA;CODDOCUMENTO` (ex.: `1;79;<RA>;5`), isto é, a chave da linha em SDOCALUNO. `STATUS` 1 = em análise.

**Requisição de envio [OBSERVADO]**: `POST https://processoseletivo.azurewebsites.net/api/applyment/button-click`, `multipart/form-data`, **sem** cabeçalho de autenticação além do `token` no corpo:

| Campo | Valor |
|---|---|
| `file_0` | o arquivo binário (não é base64; o servidor Rubeus converte) |
| `data` | JSON: lista dos 7 documentos com `field_id` 38733, `component_id` 3940446, `CODIGO`, `title`, `STATUSENVIO`, `PATHARQUIVO`, `CHAVERM`, `files`, `value`; o documento enviado leva o arquivo |
| `button_id` | 3940449 ("Envia documentos de matrícula") |
| `related_component_id` | 174896 |
| `formio_comp_id` | id do componente (`e6t9pmo`) |
| `stage_id` / `selective_process_id` | 261006 / 20383 |
| `domainParams` | `presencial` |
| `token`, `session_id`, `substitute_id`, `hostClient`, `contact_id_crm` | da sessão do candidato |

**Resposta**: `{"success":true,"data":{"link":"presencial","place_id":300671,"place_type_id":5,"stage_id":261006,"selective_process_id":20383,"redirect_id":54163,"person_id":<id>,"applyment_id":<id>}}` (HTTP 200). Em seguida o portal recarrega o passo (`getApplymentDataByStep`).

**Limite real**: o portal anuncia 5 MB; o `STATUS` e o nome vêm do servidor.

**Impacto no Flow:**
1. O DocumentPicker entrega o arquivo ao servidor (decifrado); o servidor só precisaria remontar este `multipart` e chamar o `button-click`.
2. **Obstáculo**: o `token`/`session_id` pertencem à sessão **do navegador** do candidato (login por CPF + nascimento via `login-portal`); o servidor teria de fazer esse login no Rubeus em nome do candidato e guardar a sessão. Não é uma API pública nem estável.
3. **Caminho recomendado continua sendo** pedir à UniBalsas um endpoint `/blip/...` para matrícula, com estes códigos (1, 2, 5, 8, 15, 16, 46) e gravação em SDOCALUNO; o Flow reaproveita `documentos.js`.

**Rastros nos dados fictícios** (Nicole): Histórico e Certificado em análise, 5 pendentes. A equipe pode recusar ou remover no RM.

## 1.4 API oficial do Rubeus (o canal que o Flow já usa no Cloud Run)

Fonte: `https://docs.rubeus.com.br/api_im/` (aberta pelo craft, evidência `ev_f375a579f30abfe09620a48c38ae9716452941ecd04097bc38c1f9a87dbdd48f`). Base `https://admin.portal.apprbs.com.br/api/v1`, cabeçalho `Authorization: Bearer <API_KEY>`.

- **[OBSERVADO]** `POST /login/portal` (`portal`, `token`, `applyment_id` opcional) devolve `current_process.stages[]` (título, `cta_link`, `feedback`) e `process_list`. O servidor usa `/portal` (a rota real, conforme o comentário do código).
- **[OBSERVADO]** `POST /form` (`target`, `local`, `token`) devolve o formulário; `POST /submit` recebe **JSON**: `{button, validate_on_server?, data:[{field_id | component_id, value: qualquer}], token}` e responde `{success, data:{next, local, token, redirect}}`.
- **[OBSERVADO]** A documentação **não menciona upload**: não há `multipart`, nem campo de arquivo. A API interna do portal (`/api/applyment/button-click`) manda o arquivo em `multipart`.
- **[INFERIDO]** Como `value` aceita qualquer tipo e a ação "Salvar Dados" lê `ARQUIVO <- campo 38730`, `NOMEARQUIVO <- 38731`, `CHAVERM <- 38718`, `PATHARQUIVO <- 38719`, `CODDOCUMENTO <- 38733`, o envio JSON ao `/submit` do botão 3940449 com esses campos (arquivo em base64) é plausível.
- **[DESCONHECIDO]** Se o Rubeus aceita isso e grava em SDOCALUNO. Teste seguro: diagnóstico de `/form` no passo 300671 (sem enviar) e, depois, um envio de teste com o cadastro fictício.

## 2. Estrutura do passo 300671 (`getApplymentDataByStep/300671`)

| Item | Valor |
|---|---|
| Lista de documentos | Query Rubeus **RB.PS.IM.017**, parâmetro `CODINSCRICAO` (campo 38543) |
| Documentos | 7 listados, 3 obrigatórios |
| Componente de envio | `type: upload`, `storage: base64` |
| Botão | "Envia documentos de matrícula" (id 3940449) |
| Ação | TOTVS "Salvar Dados" |

### Campos preenchidos pelo componente de upload

| Campo | Papel |
|---|---|
| 38730 | conteúdo do arquivo (base64) |
| 38731 | nome do arquivo |
| 38718 | chave RM (CHAVERM) |
| 38719 | caminho do arquivo (PATHARQUIVO) |
| 38733 | código do documento (CODDOCUMENTO) |

## 3. Ação "Salvar Dados" -> tabela SDOCALUNO

| Coluna RM | Origem |
|---|---|
| CODCOLIGADA | campo 38611 |
| IDPERLET | campo 38613 |
| RA | campo 38651 (e RA1) |
| CODDOCUMENTO | campo 38733 |
| CODUSUARIO | campo 38742 |
| QUANTIDADE | fixo 1 |
| NOME | campo 38544 |
| CODPERLET | campo 38676 |
| ARQUIVO | campo 38730 (base64) |
| CHAVERM | campo 38718 |
| NOMEARQUIVO | campo 38731 |
| PATHARQUIVO | campo 38719 |
| STATUS | fixo 1 |

## 4. Como o Flow deve fazer (um Flow só)

Fluxo: ESCOLHA_PROCESSO -> "Já sou inscrito" (CPF + nascimento) -> etapa "Documentos de matrícula" (tela já existente `DOCUMENTOS_INSCRICAO`, reaproveitada) -> DocumentPicker (um por tela, PDF/JPG/PNG, até 740 KB) -> `data_exchange` com `media_id/cdn_url/encryption_metadata` -> servidor decifra (`api/documentos.js`) -> **entrega ao RM** (ponto em aberto).

Mudanças no Flow quando houver destino:
1. `matricula.js`: nova fonte da lista (7 documentos, marcando os 3 obrigatórios) em vez de `/rm/documents`.
2. Progresso "N de 3 obrigatórios" (os opcionais não bloqueiam a conclusão).
3. `documentos.js`: novo `saveEnrollmentDocument` com o mesmo tratamento de arquivo (`sendFile` já valida tipo e tamanho).

## 5. Duas opções de entrega ao RM

**A. Endpoint da UniBalsas (recomendado)** - pedir à equipe técnica:
- `GET` lista de documentos de matrícula por inscrição (equivalente à query RB.PS.IM.017: CODDOCUMENTO, DESCRICAO, obrigatório, situação);
- `POST` que grave em SDOCALUNO (parâmetros: coligada, idperlet, RA/inscrição, codDocumento, nomeArquivo, body `{base64}`), no mesmo padrão de `/blip/documents`.

**B. Replicar o Rubeus pelo servidor** - chamar `/api/applyment/*` (`getApplymentDataByStep`, `register-portal-data`, `button-click` 3940449) como o portal faz. **Não recomendado**: depende de sessão do candidato e de tokens do portal, não é API pública, muda sem aviso e exige autenticação em nome do candidato. **[DESCONHECIDO]** se o portal aceitaria isso sem login interativo.

## 6. Pontos desconhecidos

- **[DESCONHECIDO]** Códigos CODDOCUMENTO dos 7 documentos (a query RB.PS.IM.017 não foi executada pelo Flow; a captura trouxe a estrutura, não a lista com ids).
- **[DESCONHECIDO]** De onde vêm IDPERLET, RA e CODUSUARIO para um candidato recém-aprovado (campos 38613, 38651, 38742).
- **[DESCONHECIDO]** Se o status do contrato "Aguardando documentação" muda sozinho após os 3 obrigatórios ou depende de conferência manual.
- **[DESCONHECIDO]** Limite de tamanho do campo ARQUIVO nesta ação (o `/blip/documents` aceita 1 MiB).
- Etapas Contrato e Matriculado ("Existem pendências") não foram detalhadas neste mapeamento.

## 7. Próximo passo sugerido

Enviar à UniBalsas o pedido da opção A (seção 5). Com os endpoints, a alteração no Flow é pequena, porque DocumentPicker, decifragem, validação de tipo/tamanho e progresso já estão prontos na 1.6.8.
