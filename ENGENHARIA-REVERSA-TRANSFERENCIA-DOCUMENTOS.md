# Engenharia reversa — Transferência 2027/1 (20385): etapa Documentos inscrição

> **Estado no Flow (2.14.0, 17/11/2026):** implementado e publicado. Como o Flow e o Run fazem: `ENGENHARIA-FLOW-INSCRICAO-DIRETA.md`. Este documento guarda o que o site faz (rotas, campos, textos).

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

## D. No Flow (2.14.0)

Obrigado → Portal (Documentos inscrição: Pendentes) → Histórico acadêmico (28\*), Planos de ensino (29) e Declaração de vínculo (27), um por tela → status com "Em análise" (tela final). O worker entra no portal, acha a etapa pelo link, envia num único "Enviar" multipart e confere no passo; o vigia acompanha a análise (recusa → reenvio só dos recusados; aprovado → aviso e segue para a matrícula).

## E. Telas e textos do site, na ordem (copiados em 17/11/2026)

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
