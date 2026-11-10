# Versão 1.7.0 — Documentos pelo Blip (Flow termina em `complete`)

## O que mudou

Quando o Flow roda no Blip, o arquivo chega no `nfm_reply` (`#wa.interactive.nfm_reply.json_response`) já baixado e decifrado pelo Blip, com `file_name` e `file_url` (link temporário do Azure Blob, cerca de 30 minutos). O servidor não precisa decifrar nada nesse caminho.

1. **`POST /api/documento`** (header `x-api-key: BLIP_DOCS_KEY`). O bot envia `{ json_response, cpf, processo_seletivo_id }` (ou `idps`). O servidor valida, baixa o `file_url`, confere `sha256`, tipo (PDF/JPG/PNG) e 740 KB, confere que o documento é um dos exigidos pelo processo e grava em `/blip/documents`. Responde `{ ok, mensagem, documento, nomeArquivo, primaryKey }` ou `{ ok:false, mensagem }` (400 dados inválidos, 401 sem chave, 422 arquivo/RM recusou).
2. **`GET /api/documento?processo_seletivo_id=20385`**: lista `{id,title}` e o texto para o bot montar o Flow.
3. **`flow-documentos-blip.json`**: Flow de uma tela (`DOCUMENTOS`, terminal) com Dropdown, DocumentPicker (740 KB) e `complete` com `{documento, arquivo}`. Os dados da tela vão no `flow_action_payload` ao enviar o Flow (`documentos` e `texto`, vindos do GET).
4. **Segurança:** a URL assinada não vai para log nem resposta; só hosts da lista (`BLIP_MEDIA_HOSTS`), HTTPS, sem seguir redirecionamento, limite de 740 KB na leitura. `codDocumento` só vale se estiver em `/rm/documents` do processo.
5. Inclui tudo da 1.6.6 (correção do Dropdown e progresso dos documentos no Flow com endpoint).

## Como o bot usa

1. Antes de enviar o Flow: `GET /api/documento?processo_seletivo_id=…` → `flow_action_payload.data = { documentos, texto }`; `flow_token` por sessão.
2. Ao receber o `nfm_reply`: `POST /api/documento` com `json_response` (texto cru), `cpf` e `processo_seletivo_id`; responder ao candidato com `mensagem`.
3. O picker aceita um arquivo por vez: para vários documentos, reenviar o Flow para o próximo. O contador "N de M" fica no bot.

## Limite conhecido

Na Transferência o portal lista 3 documentos e só vira "Em análise" com os três; `/rm/documents` (idps 225) devolve só o Histórico. Depende da UniBalsas expor os outros dois `CODDOCUMENTO`.

## Atualizar

Servidor: `api/documento-blip.js` (novo), `api/documentos.js`, `server.js`, `api/flow.js`, `package.json`. Definir `BLIP_DOCS_KEY` no Cloud Run (valor aleatório longo, o mesmo no bot do Blip). Importar `flow-documentos-blip.json` como um segundo Flow na WABA (o `flow-waba.json` é o da 1.6.6). 111 testes locais. Versão esperada no `GET /api/flow`: `unibalsas-cloudrun-jornada-1.7.0`.

---
# Versão 1.6.6 — Documentos da inscrição: correção do Dropdown e progresso

## O que mudou

1. **Corrige o erro do Flow** `Component Validation Error: Dropdown should NOT have additional properties (descricao)` na tela `DOCUMENTOS_INSCRICAO` (Transferência, Portador de Diploma e ENEM). O servidor guardava `{id,title,descricao}` e repassava tudo ao Flow, que só aceita `{id,title}`. Agora `responseForScreen` projeta toda lista de opções para `{id: String(id), title}`; `descricao` fica só no estado selado (usada no texto e no nome do documento enviado). Vale também para cursos, turnos, anos, origens, UFs, cidades, raças, estados civis, escolas e processos.
2. **Progresso dos documentos.** A tela mostra "N de M documentos enviados. Falta: …". O reenvio do mesmo documento é "atualizado" e não conta duas vezes.
3. **Conclusão.** Com todos os documentos da lista enviados, a tela passa a "Documentos enviados ✅", sem Dropdown nem seletor, e o rodapé vira **Atualizar situação**.

**Atualizar também o JSON da WABA** (`flow-waba.json`): `DOCUMENTOS_INSCRICAO` ganhou os dados `progresso` e `concluido` e três estados exclusivos (enviar, concluído, processando). Limites do seletor preservados (PDF/JPG/PNG, 740 KB).

## Limite conhecido

O portal da Transferência lista 3 documentos e só passa de "Pendentes" para "Em análise" com os três; a API `/rm/documents` (idps 225) devolve só o Histórico (28). O Flow conclui com os documentos que a API informa e orienta a terminar pelo Portal se ainda houver pendência. Depende da UniBalsas expor os outros dois `CODDOCUMENTO`.

## Validação

104 testes locais (inclui `dropdown-options.test.js` e `documentos-progresso.test.js`). Não testado: prévia/aparelho real, nem o caminho do Blip. Ver `CHECKLIST-TESTES-1.7.0.md` e `ENGENHARIA-REVERSA-TRANSFERENCIA-DOCUMENTOS.md`. Versão esperada no `GET /api/flow`: `unibalsas-cloudrun-jornada-1.6.6`.

---
# Versão 1.6.4 — Prova aguardando correção

## O que mudou

Depois da redação, quando o portal mostra **Prova online: Aguardando correção**, a tela de acompanhamento deixa de oferecer "Continuar: Prova online" (não há o que continuar até a correção da equipe).

- Título "Aguardando correção ⏱" e a mensagem do portal: "Você realizou a sua prova. Em breve o resultado estará disponível."
- Dois botões: **Portal do Candidato** (abre a situação da jornada no site) e **Encerrar** (fecha o Flow).
- Se houver outra etapa disponível (ex.: documentos), o botão Continuar permanece.
- No painel de login ("Já sou inscrito") a etapa aparece com ⏱ e o botão é Atualizar situação.

**Atualizar também o JSON da WABA** (`flow-waba.json`): a tela ACOMPANHAMENTO ganhou o dado `aguardando_resultado` e o link Portal do Candidato. Versão esperada: `unibalsas-cloudrun-jornada-1.6.4`. 94 testes locais.

---# Versão 1.6.3 — Envio de documentos pelo WhatsApp na fila durável

## O que mudou (somente servidor; o JSON da WABA não muda)

1. `enviar_documento` passa a rodar no worker (Cloud Tasks + Firestore), como as demais etapas lentas. Antes, download do CDN + consulta da inscrição + POST rodavam dentro da requisição do Flow e podiam passar dos 10 s. A tela mostra "Só um instante ⏳ Recebendo seu documento" e *Verificar andamento*; o resultado vem do estado real do job. Clique repetido = mesmo job (sem segundo POST).
2. Chaves de descriptografia da mídia (`arquivo`) são removidas do registro do job assim que ele termina.
3. O tipo do arquivo é conferido pelo conteúdo (PDF, JPG ou PNG). Antes, um `.docx` seria enviado como `documento.pdf`. O nome enviado segue o tipo real.
4. Sucesso só é mostrado com `status: ok` da API e, quando vem, `primaryKey` igual a `CODCOLIGADA;IDPS;NUMEROINSCRICAO;CODDOCUMENTO`.
5. Mensagens próprias: tipo inválido, acima de 740 KB, falha ao baixar a mídia, inscrição não encontrada, API fora do ar, RM ocupado (503), arquivo recusado (400) e envio sem confirmação (timeout/502: "confira no Portal antes de reenviar", pois o RM pode ter gravado). Reenviar o mesmo documento mostra "atualizado" (a API sobrescreve a mesma chave).
6. A inscrição é consultada antes de baixar o arquivo.

## Confirmado com chamadas reais de leitura (07/11/2026)

- `GET /rm/documents?codColigada=1&idps=…`: 226 → 25 BOLETIM NOTA ENEM; 225 → 28 HISTÓRICO ACADÊMICO; 224 → 10 DIPLOMA DE GRADUAÇÃO; 223 → vazio. Sem autenticação, 0,7–1,4 s.
- `GET /blip/inscritos/{idps}/{cpf}` devolve objeto com `NUMEROINSCRICAO`, `CODCOLIGADA`; 404 quando não há inscrição naquele processo.
- Meta (Media upload): DocumentPicker exige Flow JSON ≥ 4.0; um por tela; sem `init-values`; precisa ser string de primeiro nível no payload; payload traz `media_id`, `cdn_url`, `file_name`, `encryption_metadata`; mídia fica no CDN por até 20 dias; AES-256-CBC + HMAC-SHA256 (10 bytes). O Base64 é gerado no servidor.

## Não validado

- POST real em `/blip/documents` (grava de forma persistente; não foi executado sem autorização).
- Teste com o Flow importado na WABA e DocumentPicker real no aparelho.
- Se a etapa "Documentos" do Rubeus passa a concluída depois do envio ao RM (por isso o botão "Já enviei, continuar" só relê o portal).
- Metadado de mídia da BLIP: o Flow envia ao endpoint o `cdn_url` criptografado; o endpoint não depende da BLIP para obter o arquivo.

Servidor: `api/documentos.js`, `api/jobs.js`, `api/flow.js` (título da espera e versão), `api/matricula.js` (texto), `package.json`, `test/documentos-async.test.js`. Versão esperada no `GET /api/flow`: `unibalsas-cloudrun-jornada-1.6.3`. 89 testes locais.

---# Versão 1.6.0 — Login na tela inicial, acompanhamento e documentos pelo WhatsApp

## O que mudou

1. **Tela inicial com login.** `ESCOLHA_PROCESSO` agora pergunta "O que você deseja?":
   - *Fazer nova inscrição* → escolhe a forma de ingresso (como antes);
   - *Já sou inscrito* → CPF + data de nascimento na própria tela. O endpoint chama `/login` e `/login/portal` e abre o painel com a situação de cada etapa, igual ao Portal do candidato.
   A tela separada `LOGIN_CANDIDATO` (1.5.0) foi removida.
2. **O Flow não fecha mais depois da redação nem da inscrição** (ENEM, Transferência, Portador de Diploma). Em vez da confirmação terminal, abre `ACOMPANHAMENTO`: mensagem de confirmação, situação das etapas e o botão da próxima etapa disponível. Quando a próxima etapa depende da equipe (correção da redação, conferência de documentos), o painel mostra "aguardando a análise" e oferece **Atualizar situação** ou **Encerrar por agora**. Se o portal não responder nesse momento, cai na confirmação antiga (`CONFIRMACAO`).
3. **Documentos de inscrição pelo WhatsApp** (`DOCUMENTOS_INSCRICAO`, DocumentPicker), usando a API da UniBalsas (`api.unibalsas.edu.br`, artigos 743–746 da Central de Ajuda):
   `GET /rm/documents` (lista por IDPS) → `GET /blip/inscritos/{idps}/{cpf}` (número da inscrição) → `POST /blip/documents` (base64).
   Documentos hoje: ENEM = Boletim nota ENEM (25); Transferência = Histórico acadêmico (28); Portador de Diploma = Diploma de graduação (10); Vestibular não pede documento na inscrição.
   Limite de 740 KB por arquivo (a API aceita 1 MiB com o base64). A mídia é baixada do CDN do WhatsApp, conferida (SHA-256 + HMAC) e descriptografada (AES-256-CBC) no servidor; as chaves nunca entram no estado do Flow.
4. **Telas de espera mais claras.** Títulos "Só um instante ⏳ Gravando…/Preparando…/Enviando…" e mensagens explicando que leva alguns segundinhos e que tocar em *Verificar andamento* não envia nada em duplicidade.
5. **Abertura da prova sem erro intermitente.** Quando o Rubeus confirma o "Iniciar prova" sem devolver o link, o Flow monta o link oficial a partir do formulário (antes mostrava "[PROVA_LINK] O Rubeus não retornou o link da prova" e exigia "Conferir prova existente").

## Ainda pelo portal

Documentos de **matrícula** (RG, CPF, histórico/certificado do ensino médio, comprovante), **contrato** e **pagamento** continuam abrindo o Portal do candidato pela tela `ETAPA_PORTAL`, e o Flow acompanha a situação pelo painel. A API da UniBalsas grava documentos da inscrição (DOCXIDPS/EduPSDocumentoEntregue); para os documentos de matrícula, o aceite do contrato e o Pix é preciso que a equipe da UniBalsas exponha endpoints equivalentes.

## Validação

81 testes locais (incluindo descriptografia da mídia, envio do histórico ponta a ponta simulado, acompanhamento após a inscrição e queda para a confirmação antiga). Não testado em produção: login (`/login` → token aceito por `/form`), `/login/portal` com o token da inscrição recém-criada, e o envio real à API da UniBalsas.

## Atualizar

Servidor: `api/flow.js`, `api/matricula.js`, novo `api/documentos.js`, `api/jobs.js`, `api/prova-route.js`, `package.json`, `test/`. JSON da WABA: `flow-waba.json` (versão 7.3; 22 telas). Variável opcional `UNIBALSAS_API_URL` (padrão `https://api.unibalsas.edu.br`). Versão esperada no `GET /api/flow`: `unibalsas-cloudrun-jornada-1.6.0`.

---
# Versão 1.5.0 — Jornada completa (continuação da inscrição e matrícula)

## O que mudou

1. **Celular** passa a ir para o Rubeus só com dígitos (DDD + número), igual ao site oficial.
2. **Tema da redação**: removido o tema fixo antigo. O tema é sempre o sorteado pelo módulo de avaliação, lido em `iniciar_redacao`.
3. **Nova opção "Já me inscrevi: continuar"** na primeira tela. O candidato entra com CPF (ou e-mail) e data de nascimento (`/login`, `/login/portal` da API oficial) e vê a situação de cada etapa.
4. **Novas telas** (`api/matricula.js` + `flow-waba.json`):
   - `LOGIN_CANDIDATO`, `PORTAL_STATUS` (resumo das etapas e botão para a próxima);
   - `RESP_FINANCEIRO` (Eu/Outro), `RESP_DADOS` (dados do responsável), `ENDERECO` (CEP via ViaCEP, busca de cidade natal), `IDENTIDADE` (RG, órgão, UF, cor/raça, estado civil, busca de escola, ano), `CUPOM`;
   - `ETAPA_PORTAL` para documentos, contrato, pagamento, taxa e filiação (abre o portal oficial; a API oficial não documenta upload, aceite de contrato nem Pix);
   - `STATUS_FINAL` (tela terminal com a situação).
5. Listas grandes (5.568 cidades, 1.461 escolas) usam **busca por texto** + Dropdown com até 20 resultados, por causa do limite de 200 opções do Dropdown.
6. O `routing_model` da Meta só aceita rotas para frente. A jornada segue a ordem resumo → responsável → dados do responsável → endereço → identidade → cupom → portal. Se a próxima etapa do portal estiver "para trás", o Flow termina em `STATUS_FINAL` e orienta a reabrir.
7. As confirmações (inscrição, ENEM, redação) orientam a voltar por "Já me inscrevi: continuar".
8. `npm test` agora roda `test/*.test.js` (as cópias antigas soltas na raiz não são mais executadas).

## Validação

78 testes locais passam (73 anteriores + 5 novos em `test/matricula.test.js`: grafo sem ciclos, limites de componentes, correspondência JSON × servidor, jornada completa simulada e bloqueio de rota para trás).

**Não validado em produção:** as chamadas `/login`, `/login/info` e `/login/portal` seguem a documentação da Rubeus, mas a documentação não deixa claro se o `session_id` devolvido por `/login` é o token aceito por `/form` e `/submit`. O código usa `token` ou `session_id`, nessa ordem. Homologue com a inscrição de teste 14083470 antes de publicar.

## Atualizar

Servidor: `api/flow.js`, novo `api/matricula.js`, `package.json`, `test/`. JSON da WABA: `flow-waba.json` (9 telas novas, versão 7.3 mantida). Atualize os dois lados antes de testar.

```bash
curl -sS https://devflowunibalsas-git-83531798597.southamerica-east1.run.app/api/flow
```

Versão esperada: `unibalsas-cloudrun-matricula-1.5.0`.

---
# Versão 1.4.0 — Transferência e Portador de Diploma

## Base preservada

Código do ZIP devflowunibalsas-main (1).zip, versão 1.3.0, e JSON da WABA anexado pelo proprietário em 02/11/2026. O JSON do GitHub/ZIP ainda não tinha CURSO_ENEM; o JSON anexado, que está funcionando na Meta, foi usado como base para evitar regressão.

A atualização não foi publicada no GitHub, na Meta nem no Cloud Run pela assistência.

## Caminhos

- 20383 / IDPS 223: Vestibular Online. Mantém a redação já validada.
- 20386 / IDPS 226: ENEM. Mantém notas, média e conclusão já validadas.
- 20385 / IDPS 225: Transferência. Dados básicos → CURSO_INGRESSO → Estamos quase lá → confirmação.
- 20384 / IDPS 224: Portador de Diploma. Mesmo caminho de inscrição, com a identidade própria do processo.

IDs e identificadores foram conferidos na listagem pública utilizada pelo site Unibalsas. Os primeiros passos públicos foram consultados sem envio de dados pessoais. Não houve submissão de dados de candidatos ou conclusão real durante a revisão.

## Correções

1. Cada processo usa seu IDPS na contingência dos dados básicos; Transferência e Diploma não assumem mais 223.
2. Transferência/Diploma usam uma tela exclusiva CURSO_INGRESSO. As 11 telas anteriores da WABA foram comparadas e permanecem semanticamente idênticas.
3. O envio do curso usa a fila durável. A leitura do formulário seguinte ocorre no worker, com orçamento maior, preservando o token atualizado.
4. O passo e o botão final são lidos do retorno oficial do Rubeus. Exige um único botão Concluir e os campos principais do formulário. Não usa o botão 3940366 nem o passo 300663 como contingência para essas modalidades.
5. Se o curso foi recebido mas a leitura falhou, Retomar inscrição consulta apenas o formulário seguinte. Não reenvia o curso.
6. A conclusão confirmada de Transferência/Diploma vai para CONFIRMACAO. Somente o Vestibular Online vai para a redação. Também foi acrescentado um bloqueio para impedir a abertura da redação por sessões dessas modalidades.
7. Uma recusa explícita JSON/HTTP 403 nessas modalidades aparece como erro de formulário, em vez de ficar para sempre no estado de processamento. Não há repetição automática do envio. Timeouts e resultados incertos continuam protegidos contra reenvio.
8. Processos desconhecidos são recusados antes de iniciar o cadastro, para não herdar o caminho da redação inadvertidamente.

## O que permanece igual

api/avaliacao.js, api/enem.js, api/cloud-store.js, api/diagnostics.js, api/prompt-text.js, api/proof-binding.js, api/prova-route.js, server.js e Dockerfile foram comparados com o ZIP e não foram alterados. As mudanças na fila acrescentam as ações da nova tela; o fluxo de curso do vestibular e o caminho ENEM existentes mantêm seus comportamentos.

## Limites da validação

73 testes locais passaram e o servidor iniciou corretamente. Incluem as regressões anteriores de ENEM/redação, as duas novas modalidades, botões/etapas diferentes por processo, cliques repetidos, token atualizado, falha de leitura com retomada sem novo submit e resposta 403.

As chamadas Google/Rubeus dos testes são simuladas. Os IDs de passos e botões usados nos testes novos são deliberadamente sintéticos para verificar a descoberta dinâmica, não uma captura real dos formulários finais de Transferência/Diploma. O site exige sessão vinculada para ler esses formulários finais; a consulta anônima retornou 403 e não foi contornada. Em produção a leitura usa o token autenticado da própria inscrição, via API oficial, como os caminhos existentes.

Ainda é necessário importar/validar o JSON na Meta e homologar no Cloud Run com dados de teste autorizados. A confirmação de inscrição não representa aprovação acadêmica ou recebimento de documentos. O portal e as etapas posteriores não estão implementados nesta entrega.

Inscrições antigas em PENDENTE não são reenviadas nem migradas automaticamente. Não recrie um cadastro antigo apenas para testar a atualização sem conferir antes o CRM/portal.

## Atualizar

Arquivos do servidor alterados: api/flow.js, api/jobs.js, package.json e o novo api/processes.js. O pacote completo inclui todos os módulos necessários. A API não precisa de novas variáveis, banco ou fila.

Atualize também o JSON da WABA: há uma nova tela CURSO_INGRESSO e uma saída adicional em DADOS_BASICOS. Preserve a versão 7.3 do JSON. Atualize os dois lados antes de testar e reabra o Flow em uma sessão nova.

Para GitHub, copie o conteúdo da pasta release-1.4.0 para a raiz do repositório respeitando api/ e test/. O ZIP também contém essa estrutura na raiz, sem uma pasta intermediária. Evite enviar os arquivos achatados diretamente na raiz, especialmente os módulos importados de api/.

## Cloud Shell

Envie cloud-run-flow-1.4.0.zip pelo Upload do Cloud Shell. Em uma aba livre:

```bash
flow_dir=$(mktemp -d /tmp/unibalsas-deploy-XXXXXX)
unzip "$HOME/cloud-run-flow-1.4.0.zip" -d "$flow_dir" &&
gcloud run deploy devflowunibalsas-git \
  --project=talks-servidor \
  --region=southamerica-east1 \
  --source="$flow_dir"
```

Não é necessário executar implantar.sh novamente; fila, banco, chaves e permissões já configuradas permanecem necessários. O arquivo foi mantido no pacote como referência da infraestrutura anterior.

```bash
curl -sS https://devflowunibalsas-git-83531798597.southamerica-east1.run.app/api/flow
```

Versão esperada: unibalsas-cloudrun-ingressos-1.4.0.

## Logs das duas novas modalidades

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="devflowunibalsas-git" AND (jsonPayload.event="ingresso_course_received" OR jsonPayload.event="ingresso_registration" OR jsonPayload.event="flow_job" OR jsonPayload.event="rubeus_rejected" OR jsonPayload.event="flow_worker_error")' --project=talks-servidor --freshness=24h --limit=60 --order=desc --format=json
```

A evidência de conclusão esperada é ingresso_registration com process 20384 ou 20385, confirmed true e applicationId da inscrição, acompanhada de flow_job done / CONFIRMACAO e conferência no CRM.
