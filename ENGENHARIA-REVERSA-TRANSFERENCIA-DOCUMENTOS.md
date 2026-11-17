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

---

# Atualização 17/11/2026 — inscrição completa pelo site, com corpos capturados

Inscrição nova, do zero, com dados fictícios do 4devs fornecidos pelo usuário: **Rebeca I. S. Drumond** (fictícia), Direito – Noturno, **applyment 14320114**, person_id 10163869, contato CRM 607803. Corpos de requisição e respostas capturados no navegador. Isso resolve quase todo o "Não verificado" acima.

## A. Inscrição (stage 261026) — mesmo motor do Vestibular

`start-applyment` (process_id 20385) → `getApplymentDataByStep/{passo}` → `button-click` (JSON). São os mesmos endpoints e os mesmos campos do Vestibular; mudam o IDPS, os IDs de passo e de botão e o CODPOLO.

| Passo | Tela | Botão / componente relacionado | Campos enviados |
|---|---|---|---|
| 300692 | Dados básicos | **3940623** / 174874 | 38544 nome, 38545 e-mail, 38546 celular (só dígitos), **38548 IDPS = "225"**, 38564 gênero F, 38565 = 2, 38566 nascimento `AAAA-MM-DD`, 38606 nome social, 38679 = true, 38707 = "1", 38708 = "4" |
| 300693 | Curso de interesse | **3940633** / 174875 | 38627 curso `1-20`, 38547 turno `6`, **38550 CODPOLO = "01"** (o Vestibular não envia), 38552 CODOFERTA `1-225-38`, 38553 área `38`, 38610/38611/38612 = `1` |
| 300694 | Estamos quase lá → **Concluir** | (corpo perdido no redirecionamento) | 38567 CPF, 38780 nacionalidade (`10`), 251544 ensino médio, 38575 deficiência, 319427 origem (consulta `RB.PS.IM.043`, códigos `01`…`10`, iguais aos do Vestibular) |

- **IDPS acadêmico da Transferência = 225** (confirmado em 38548 e no CODOFERTA `1-225-…`), o mesmo de `api/processes.js`.
- Cursos: consulta `RB.PS.IM.006`, 11 ofertas (Agronomia, ADS, Biomedicina, Ciências Contábeis, Direito, Enfermagem, Estética e Cosmética, Medicina Veterinária, Odontologia, Produção Publicitária e Psicologia). O turno é preenchido sozinho quando o curso tem só um.
- Ao concluir, o site vai para `seletivo.unibalsas.edu.br/obrigado-3`, igual ao Vestibular, e a sessão continua logada no portal.
- O `applicantData` já trouxe um CODUSUARIOPS (38608 = 20170) e um 319427 = "ADMINISTRAÇÃO- NOTURNO": o CPF do 4devs já existia no RM e o portal mistura dados do cadastro antigo. Não é comportamento do formulário.

## B. Portal após a inscrição (`register-portal-data`, ~6 s)

| Momento | Etapas |
|---|---|
| Logo após concluir | 261026 Inscrição **Concluída** · 261028 Documentos inscrição **Pendentes** + Verificar (`presencial/passo/300696`) |
| Após enviar os 3 | 261026 Concluída · 261028 **Em análise**, sem botão (`cta_text` e `cta_link` vazios) |

Nenhuma etapa seguinte aparece enquanto os documentos estão em análise. As etapas seguintes da Transferência já foram mapeadas com o Caleb (seções 13–17 de `ENGENHARIA-REVERSA-VESTIBULAR-2027.md`): resp. financeiro 300706 (botão 3940750) → pré-matrícula 300697/300698 → documentos de matrícula 300702 → contrato 300700 → pagamento 300701.

## C. Documentos de inscrição (passo 300696, stage 261028) — contrato real

- `getApplymentDataByStep/300696` (~1,1 s): componente `upload` **3940672**, `upload_content` vem da consulta `RB.PS.IM.012`:
  - `28` HISTÓRICO ACADÊMICO, `OBRIGATORIO` 1
  - **`29` PLANOS DE ENSINO (EMENTAS)**, 0
  - **`27` DECLARAÇÃO DE VINCULO ACADÊMICO**, 0
- Campos de gravação no componente: `field_id_related_to_component` / tipo = **38633**, base64 = 38631, status = 38632, nome = 38634. Limite de 5 MB; tipos 1, 2, 3 e 7.
- Botões: **3940675 "Enviar"** (`store_data` 1, relacionado 174882) e 3940674 "Portal do candidato".
- **Envio (`button-click` multipart):** `button_id 3940675`, `related_component_id 174882`, `stage_id 261028`, `last_place_id 300696`, `last_place_type_id 1`, `selective_process_id 20385`, `contact_id_crm`, `session_id`, `substitute_id`, `hostClient`, `domainParams presencial`, `formio_comp_id`, `rbParams "null"`, partes binárias `file_0`, `file_1` e `file_2`, e `data` com o campo 38633 (componente 3940672, `type:"upload"`):
  `[{CODIGO:"28",title,STATUSENVIO:null,PATHARQUIVO:null,CHAVERM:null,ADICIONAL:null,ADICIONAL2:null,files:[{}],value:["file_0"]}, {CODIGO:"29",…,value:["file_1"]}, {CODIGO:"27",…,value:["file_2"]}]`
  Mais três itens de conteúdo (3940668, 3940670 e 3940671) com valor vazio.
- Resposta em **11,6 s**: `{success:true, place_id:300696, place_type_id:5, stage_id:261028, redirect_id:54154, applyment_id:14320114}`. O site volta ao portal.
- Releitura do passo: os 3 itens com **`STATUSENVIO` "1"** (em análise).
- **É exatamente o formato de `montarEnvio` / `lerPassoDocumentos` em `api/portal-site.js`.** Conferido no navegador: o leitor acharia o botão 3940675, o componente 3940672 e o campo 38633 sem nenhuma mudança. `jaEnviado` (status 1 ou 3) também vale aqui.

## D. Comparação com o Flow/Run atual (2.12.3)

| Ponto | Site | Run hoje | Ação |
|---|---|---|---|
| Inscrição (3 telas) | 300692–300694 | `etapa1-fila.js` já faz pela mesma engine (curso → `CURSO_INGRESSO`, IDPS 225) | nada |
| Depois do Concluir | Obrigado → Portal → Documentos inscrição | fecha o Flow (`sucesso`, `dados_recebidos`), sem telas de portal nem de documentos | criar telas: Concluída → Portal → Documentos de inscrição |
| Documentos de inscrição | 3 docs (28\*, 29, 27), um "Enviar" | **não existe no fluxo novo**; `DOCS` só tem os 7 da matrícula | novo bloco `documentos_inscricao` gravado no Firestore e enviado pelo worker via `portalSite.enviarDocumentos` no passo da etapa |
| Etapa 2 com "Documentos inscrição: Pendentes" | Verificar abre 300696 | `proximaTela` cai em **MATR_RESPONSAVEL** (o resp. financeiro ainda nem existe no site) | tratar "documentos inscrição" antes do resp. financeiro |
| Worker com próximo passo "document…" | — | `/document/` confunde inscrição com matrícula e enviaria os códigos 1, 2, 5… para o 300696 | separar por `/inscri/` × `/matric/` |
| "Em análise" | sem botão | `next` = null → só status e Fechar | ok; vigia/aviso quando liberar o resp. financeiro (como na redação) |

## E. Plano para o Flow (mesma lógica da redação)

1. **Etapa 1, Transferência:** depois de "Concluir", em vez de fechar, segue igual ao site:
   - `INSC_CONCLUIDA` (Obrigado)
   - `INSC_PORTAL`, com "Inscrição: Concluída" e "Documentos inscrição: Pendentes" + Verificar
   - Telas de documento: **Histórico acadêmico\*** (obrigatório), **Planos de ensino** e **Declaração de vínculo**, uma por tela, como a matrícula
   - Fim: "Recebemos seus documentos. A análise ocorre em até 48 horas úteis."
2. **Firestore primeiro:** cada arquivo vai para `blocos.documentos_inscricao` na hora (como `gravarDocumento`) e o Flow responde de imediato.
3. **Worker:** depois que a inscrição tem `applyment_id`, ele:
   - entra no portal (`entrar` com CPF e nascimento);
   - lê o passo de "Documentos inscrição" pelo `cta_link` do `register-portal-data`, sem fixar 300696;
   - faz **um** `button-click` com todos os arquivos (`montarEnvio`);
   - grava `enviados_docs_inscricao`.
   Repetição segura: pula os que já estão com `STATUSENVIO` 1 ou 3.
4. **Vigia:** depois de "Em análise", o vigia segue o portal. Quando aparecer "Seleção resp. financeiro: Pendente", manda o aviso pelo Blip, como na aprovação da redação, e o candidato entra na etapa 2 normal (resp. financeiro → pré-matrícula → docs → contrato → pagamento), que já é genérica por título de etapa.
5. **Etapa 2:** `proximaTela`/`MATR_STATUS` precisam reconhecer "Documentos inscrição: Pendentes" e abrir as telas de documentos de inscrição (quem fechou o Flow antes de enviar). O worker precisa separar inscrição de matrícula.
6. Não mexer no Vestibular: tudo condicionado a `isDirectRegistration(processo)`. Portador (300681: 10\*, 17, 26) e ENEM (300711) usam o mesmo componente e podem reaproveitar a mesma solução, com a lista de documentos lida do passo.

## F. Telas e textos do site, na ordem (copiados em 17/11/2026)

Base para as telas do Flow ("igual ao site"). Barra lateral da inscrição: "Transferência - 2027/1 · Inscrição", com os passos Dados básicos / Curso de interesse / Estamos quase lá. Cada passo mostra "Aguardando conclusão" (atual), "Pendente" (futuro) ou "Concluído".

**1. Escolha do processo** (`/presencial`): "Escolha o processo seletivo", com o select "Selecione uma opção" e a opção **"Transferência - 2027/1"**, e o botão **"Iniciar inscrição"**. No topo fica o botão LOGIN.

**2. Dados básicos (300692)**
- Título: "Olá! Para começar, preencha alguns dados básicos sobre você:"
- Campos:
  - Nome completo \*
  - ☐ Possuo nome social (abre "Nome social")
  - E-mail \*
  - Data de nascimento \* (dd/mm/aaaa)
  - Celular \*, com a ajuda "Para facilitar o nosso contato, informe o seu WhatsApp, de preferência."
  - Gênero \*: Masculino / Feminino
  - ☐ "Aceito receber conteúdos e lembretes sobre o processo seletivo. Ao informar os meus dados, eu concordo com a Política de Privacidade vigente." \* (o link vai para lp.unibalsas.edu.br/lgpd/)
- Botões: VOLTAR | AVANÇAR

**3. Curso de interesse (300693)**
- Título: "Conte-nos mais detalhes sobre o curso de seu interesse!"
- Campos: Curso \* (select com busca, "Digite para procurar") e Turno \*. O turno vem preenchido quando o curso tem um só turno.
- Botões: VOLTAR | AVANÇAR
- Cursos e turnos:
  - Agronomia — Noturno
  - Análise e Desenvolvimento de Sistemas — Noturno
  - Biomedicina — Noturno
  - Ciências Contábeis — Noturno
  - Direito — Noturno
  - Enfermagem — Noturno
  - Estética e Cosmética — Noturno
  - Medicina Veterinária — Integral
  - Odontologia — Integral
  - Produção Publicitária — Noturno
  - Psicologia — Noturno (código de turno 2)

**4. Estamos quase lá (300694)**
- Título: "Estamos quase lá!", com o subtítulo "Complete as suas informações para concluir a sua inscrição."
- Campos:
  - CPF \*
  - Nacionalidade \* (padrão Brasileira)
  - "Você já concluiu o ensino médio?" \*: Sim / Não
  - "Possui alguma deficiência?" \*: Sim / Não (Sim abre "Necessidades especiais")
  - "Como você ficou sabendo sobre este processo seletivo?" \*, com as opções:
    - Site oficial da instituição
    - Pesquisa no próprio Google
    - Redes sociais (Instagram, Facebook...)
    - Anúncios patrocinados (Google Ads, Facebook/Instagram Ads)
    - Indicação de amigos ou familiares
    - Divulgação na sua escola ou empresa
    - Feiras, palestras ou eventos presenciais
    - Contato do time comercial (telefone, WhatsApp etc.)
    - Materiais impressos (cartazes, panfletos, outdoors)
    - Outro
- Botões: VOLTAR | **CONCLUIR**

**5. Obrigado** (`seletivo.unibalsas.edu.br/obrigado-3`): "Obrigado pelo seu cadastro!", "Nossos consultores entrarão em contato com você em breve." e "Aproveite para conhecer mais sobre a nossa instituição acessando nossas redes sociais!". Botão **"Acessar Portal do Candidato [Presencial]"**. É a mesma página do Vestibular.

**6. Portal do candidato** (`/presencial/portal-inscrito`)
- Cabeçalho: "Portal do candidato", com "+ Nova inscrição" e o nome em maiúsculas.
- "Processos abertos": "Transferência - 2027/1 - DIREITO - NOTURNO-"
- "Detalhes da inscrição": Dados (Editar), Curso, Modalidade, Campus, Forma de ingresso
- "Acompanhe aqui o status da sua inscrição":

  | Etapa | Antes dos documentos | Depois dos documentos |
  |---|---|---|
  | Inscrição | Concluída | Concluída |
  | Documentos inscrição | **Pendentes** + botão **Verificar** | **Em análise** (sem botão) |
- Enquanto busca, o portal mostra "Buscando dados da inscrição. Estamos buscando seus dados, aguarde alguns instantes...", que dura cerca de 6 s.

**7. Página da etapa Inscrição** (link da etapa concluída, `presencial/feedback/920259`)
- "Parabéns! Sua inscrição foi concluída com sucesso, acompanhe o andamento deste processo no portal do candidato."
- "Confira as principais informações sobre o seu curso:"
  - Curso: DIREITO - NOTURNO-
  - Modalidade: Presencial
  - Local de estudo: UNIBALSAS EDUCACIONAL LTDA
  - Turno: NOTURNO-
- Botão PORTAL DO CANDIDATO

**8. Documentos de inscrição (300696)**
- Barra lateral: "Documentos inscrição · Documentos de inscrição · Aguardando conclusão"
- Título: "Envio de arquivos". Regras, na lista numerada do site:
  1. Os documentos enviados devem ter as extensões png, jpg, jpeg ou pdf;
  2. Não é possível enviar arquivos maiores que 5MB;
  3. Cada arquivo a ser enviado deve conter todas as páginas do documento, incluindo frente e verso;
  4. Para cada arquivo enviado, será possível acompanhar a situação da análise do mesmo;
  5. Os documentos marcados com asterisco são obrigatórios. A UNIBALSAS tem o direito de indeferir posteriormente a presente matrícula, por razões de ordem administrativa, quando não houver o envio completo da documentação competente, que deverá ser enviada no prazo máximo de 30 (trinta dias) a contar da presente data.
  6. A análise dos documentos ocorre dentro de 48 horas úteis.
- Itens:
  - HISTÓRICO ACADÊMICO \*
  - PLANOS DE ENSINO (EMENTAS)
  - DECLARAÇÃO DE VINCULO ACADÊMICO
- Antes do envio, cada item tem o botão "ANEXAR". Depois de anexar, aparece o nome do arquivo com um "x" para remover e surge o botão **ENVIAR**.
- Botões: PORTAL DO CANDIDATO | ENVIAR
- Depois do envio, cada item mostra **"EM ANÁLISE"** com o ícone de relógio, e o arquivo é renomeado para o nome do documento (ex.: "HISTÓRICO ACADÊMICO.pdf"). O ENVIAR some e fica só PORTAL DO CANDIDATO.

## Ainda em aberto

- Corpo do `button-click` do passo 300694 (perdido no redirecionamento; os campos são os da tela, iguais ao Vestibular).
- Quanto tempo a equipe leva para tirar de "Em análise" e qual texto o resp. financeiro mostra quando liberar (a inscrição 14320114 fica para acompanhar).
- Se o reenvio de um documento recusado (`STATUSENVIO` 2) usa o mesmo botão (provável; não testado).

## Rastros deste teste

Inscrição 14320114 (Direito Noturno) com 3 PDFs de teste de 613 B ("DOCUMENTO DE TESTE - NAO VALIDO - Teste"), anexados por script. Nenhum pagamento.
