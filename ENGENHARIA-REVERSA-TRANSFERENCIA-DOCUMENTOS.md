# Engenharia reversa — Transferência 2027/1 (20385): etapa Documentos inscrição

Capturado em 09/11/2026 em `vestibular.unibalsas.edu.br/presencial` com a inscrição fictícia de teste abaixo (login feito pelo usuário; as demais ações foram autorizadas por ele). Fontes: leitura das telas, lista de chamadas `/api/applyment/*` (só método, URL e status) e o corpo de duas respostas. **Corpos de requisição não ficaram visíveis**; o que depende deles está em "Não verificado".

## Inscrição de teste

| Item | Valor |
|---|---|
| Nome | Caleb Tomás Melo (fictício) · CPF 389.637.573-31 · nascimento 05/10/1982 |
| Processo | 20385 — Transferência - 2027/1 · Análise e Desenvolvimento de Sistemas, Noturno |
| applyment_id / protocolo | 14150234 |
| person_id | 10037716 |
| Etapa (stage_id) | 261028 · passo `300696` "Documentos de inscrição" |
| Arquivos enviados | 3 PDFs de teste (413 bytes, texto "ARQUIVO DE TESTE - NAO VALIDO") |

## 1. Como o site funciona

1. Login do portal: `check-login`, `login-info`, `login-portal` (CPF + data de nascimento), depois `person-applyment`, `settings/selective-process` e `register-portal-data`.
2. `register-portal-data` devolve as etapas e o `feedback.complementary_text` que o painel exibe ("Concluída", "Pendentes", "Em análise"). O botão **Verificar** leva ao passo da etapa.
3. Abrir o passo: `POST getApplymentDataByStep/300696` → formulário com título, regras de envio e o componente de upload.
4. **ENVIAR** → `POST button-click` → 200 com `place_id 300696`, `place_type_id 5`, `stage_id 261028`, `selective_process_id 20385`, `redirect_id 54154`, `applyment_id 14150234`, `person_id 10037716`. O site volta ao painel.

## 2. A tela de documentos

- Regras exibidas: png, jpg, jpeg ou pdf; máximo 5 MB; arquivo com todas as páginas (frente e verso); análise em até 48 horas úteis; prazo de 30 dias; asterisco = obrigatório.
- Lista de documentos (Transferência): **HISTÓRICO ACADÊMICO \*** (CODDOCUMENTO 28), **PLANOS DE ENSINO (EMENTAS)**, **DECLARAÇÃO DE VINCULO ACADÊMICO**. Só o primeiro tem asterisco.
- Componente `upload` (id 3940672, key `upload`): `multiple: true`, `storage: "base64"`, dentro do contêiner `3940669`. O dado vem de uma consulta personalizada TOTVS `RB.PS.IM.012` (id 78558). Os campos de gravação do arquivo no formulário (base64, nome, extensão, chave RM) existem no componente, todos nulos na leitura.
- Estados por documento: `ANEXAR` (sem arquivo) → `EM ANÁLISE` com ícone de relógio. Depois de enviado, o site mostra o nome do documento (`HISTÓRICO ACADÊMICO.pdf`), não o nome do arquivo do candidato.

## 3. Máquina de estados observada

| Situação | Painel "Documentos inscrição" | Passo 300696 |
|---|---|---|
| Nenhum enviado | Pendentes + Verificar | 3 × ANEXAR |
| 1 de 3 enviado (só o obrigatório) | **Pendentes** + Verificar | 1 × EM ANÁLISE, 2 × ANEXAR |
| 3 de 3 enviados | **Em análise**, sem Verificar | todos EM ANÁLISE |

Conclusão: a etapa só sai de "Pendentes" quando **todos** os documentos da lista estão enviados, mesmo com um só marcado como obrigatório. Depois disso o candidato não tem mais ação; a análise é da equipe. Nenhuma etapa seguinte apareceu para esse candidato.

## 4. Correspondência com a API de integração (Blip)

| Passo do site | Equivalente na API UniBalsas |
|---|---|
| Lista de documentos do passo | `GET /rm/documents?codColigada=1&idps=…` → `CODDOCUMENTO`, `DESCRICAO` |
| Número da inscrição | `GET /blip/inscritos/{idps}/{cpf}` → `NUMEROINSCRICAO`, `CODCOLIGADA` |
| Upload em Base64 do navegador | `POST /blip/documents?codColigada&idps&numeroInscricao&codDocumento&nomeArquivo` com `{base64}` |

Limites: o portal aceita 5 MB; a API aceita corpo de 1 MiB (cerca de 768 KiB de binário), por isso o Flow limita a 740 KB. A API grava como não entregue e a conferência é manual no RM. Após falha de comunicação, conferir no RM antes de reenviar.

## 5. O que o Flow precisa fazer nessa etapa (Transferência)

1. **Lista:** mostrar os 3 documentos; o payload do Dropdown leva só `{id,title}` (correção já aplicada em `api/flow.js`, ver `test/dropdown-options.test.js`).
2. **Progresso:** mostrar "N de 3 enviados" e quais faltam. Hoje a tela só acumula o texto ✅. Ao reabrir por "Já sou inscrito", refletir o que o portal já tem em `EM ANÁLISE`.
3. **Conclusão:** só quando os três estiverem enviados, avisar que a etapa está em análise (até 48 h úteis) e trocar o rodapé para "Atualizar situação" (sem "Continuar").
4. **Envio de cada arquivo:** receber a mídia (DocumentPicker, um por vez), validar PDF/JPG/PNG e 740 KB, decifrar, enviar em Base64. Não prometer aprovação, só recebimento.
5. **Repetição:** reenviar o mesmo `codDocumento` pode sobrescrever; tratar como atualização, como o código já faz ("atualizado").
6. **Mapeamento IDPS:** o Flow usa `academicId(processo_seletivo_id)` para converter 20385 no IDPS acadêmico. Não confirmei esse valor para a Transferência.

## 6. Como o arquivo chega ao Flow

- Pela documentação da Meta, o DocumentPicker entrega no `data_exchange` um objeto com `media_id`, `cdn_url`, `file_name` e `encryption_metadata`; o arquivo é cifrado (AES-256-CBC + HMAC) e fica na CDN por até 20 dias. `api/documentos.js` já faz o download e a decifragem.
- Se o Flow rodar de forma que o endpoint não receba o `data_exchange`, o Blip baixa a imagem pela Graph API e anexa a URL como metadado da mensagem. Nesse caminho o arquivo só chega depois do `complete`, sem retorno dentro da tela.
- **Aberto:** qual dos dois o Blip usa no Flow de produção, e o nome e o formato do metadado.

## Não verificado

- Corpo da requisição do upload do site (como o Base64 e os campos do formulário são enviados) e se existe chamada separada à API da UniBalsas.
- Existência dos documentos no RM (o portal os mostra como EM ANÁLISE; não consultei o RM).
- Valor do IDPS acadêmico da Transferência e `CODDOCUMENTO` dos documentos 2 e 3.
- Se há etapas depois de "Em análise" e o que as libera.
- O envio pelo Flow ainda não foi testado nesta rodada.

## Rastros dos testes

Três documentos de teste ficaram gravados na inscrição 14150234. Anexei os arquivos por script no campo da página, porque o navegador do app não abre o seletor de arquivos. Se a equipe precisar limpar, a remoção é no RM; o portal não mostrou como excluir.
