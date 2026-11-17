# Versão 2.12.0 — Avisos pelo WhatsApp (Blip) e cobrança da taxa de matrícula com Pix

- **Avisos automáticos** (template `unibalsas_atualizacao_processo`): quando o vigia confirma no portal que a etapa anterior foi concluída e a próxima abriu.
  - **Documentos aprovados / contrato liberado:** sai depois que o contrato já foi gerado (não avisa quem abriu o contrato pelo Flow).
  - **Matrícula concluída:** Pagamento "Recebido" / Matriculado "Parabéns!" (só para quem o vigia viu com o pagamento pendente).
- **Vigia da redação (novo):** quando a etapa 1 confirma a redação no portal, agenda o vigia (`redacao_vigia`, coleção `redacaoVigia`; único ajuste na etapa 1: o gancho `aoConfirmarRedacao`, sem mudar o que ela faz). Aviso **aprovada** (Prova concluída e a etapa seguinte aberta com o botão do site) ou **não aprovada** (saiu de "Aguardando correção" sem concluir e voltou o botão). Celular da inscrição; quem entrou pelo login usa a página "Meus dados". 10 min nas 2 primeiras horas, depois de hora em hora, até 15 dias.
- **Cobrança** (template `unibalsas_cobranca_matricula`): com o contrato assinado e o Pagamento com "Verificar", o Run faz o que o botão "Realizar pagamento" (Pix) do site faz (`button-click` do botão com lógica "P" → popup 1016) e manda o **Pix copia e cola** (order_details `pix_dynamic_code`) e o **link do portal** para cartão. Valor: campo 53443 (ou 38658). Referência: `mat-{IDBOLETO}`.
- **Nome e celular** vêm do próprio portal (`applicantData` dos passos do contrato/pagamento, campos 38544/38546; reserva: página 432 "Meus dados") e ficam na fila criptografada. Celular nunca no log.
- **Uma vez só, com novas tentativas:** cada aviso grava `avisos.{chave}`; falhou, tenta de novo (até 5 vezes; a cobrança a cada 10 min, reaproveitando o mesmo Pix por 12 h).
- **Variáveis no Cloud Run:** `BLIP_API_URL` (`https://unibalsasnovonegocio.http.msging.net`), `BLIP_BOT_KEY`, `PIX_CHAVE` (CNPJ `07344774000189`). Opcionais: `BLIP_TEMPLATE_ATUALIZACAO`, `BLIP_TEMPLATE_COBRANCA`, `PIX_RECEBEDOR`, `PAGAMENTO_LINK`, `BLIP_FLOW_ID`/`BLIP_STATE_ID`/`BLIP_MASTERSTATE`, `AVISOS_DESLIGADOS=1` (desliga tudo). Sem as chaves, nada é enviado (só log `nao_configurado`).
- Logs: `etapa_aviso`, `blip_aviso` (tipo, enviado, http, motivo), `etapa_final` (`cobranca_enviada`/`cobranca_falhou`, `pix_erro`).
- 194 testes. O JSON do Flow não mudou.

# Versão 2.11.0 — Etapa final (Pagamento → Matriculado) e vigias mais econômicos

- **Etapa final, igual para todos os processos:** Pagamento "Pendente/Verificar" → "Recebido" e Matriculado "Existem pendências" → "Parabéns!". O pagamento é feito fora do Flow (no Flow, "Verificar" no Pagamento mostra o texto do site: Pix ou Cartão de crédito pelo Portal do candidato). Novo **vigia final** (`tipo: etapa4_vigia`, de hora em hora por até 30 dias): registra `pagamento_liberado_em` (momento da mensagem de pagamento) e `matricula_concluida_em` (fim da jornada; momento do aviso final). Log `etapa_final`.
- **Vigia do contrato:** a cada 10 min nas 2 primeiras horas e depois de hora em hora (`VIGIA_INTERVALO_LONGO_S`); **não gera de novo um contrato já assinado** (passa direto ao vigia final); com o contrato pronto, agenda o vigia final.
- Revisão técnica e modelo de mensagem para a Meta: `REVISAO-ARQUITETURA-2027.md`. O JSON da WABA não mudou desde a 2.10.0. 185 testes.

# Versão 2.10.0 — Status igual ao portal (botão por etapa) e contrato refinado pela captura do site

- **Login → tela de status igual ao Portal do candidato** (`MATR_STATUS`, componente NavigationList do WhatsApp): uma linha por etapa (✅ concluída / ❗ pendente), com o status do site e, **nas etapas abertas, o botão do site** (ex.: "Verificar"). Tocar numa etapa aberta leva à sua tela (subetapas da matrícula, documentos, contrato); etapa ainda fora do Flow (pagamento) mostra a orientação do site; concluída ou aguardando a equipe só mostra o status. Prova liberada continua indo ao "Portal do candidato" da etapa 1 (sem mudar a etapa 1). Sem status ainda: tela "Estamos buscando…" com **Atualizar**. A NavigationList não aceita outros componentes na tela (sem logo nessa tela).
- **Contrato igual à captura do site (seção 16 da engenharia reversa):** no `button-click` os campos vão com `component_id: null`, `key` numérica e tipo do Form.io (`checkbox`/`textfield`), mais os textos visíveis do passo com valor vazio.
- **Mais rápido:** o processo da inscrição vem do `person-applyment` (~0,1 s) em vez do `register-portal-data` (~14 s), nos documentos e no contrato; o contrato gerado na hora usa o passo do status salvo.
- Novo JSON: **colar na WABA**. 184 testes.

# Versão 2.9.1 — Contrato: uma geração por vez

- Validado em 16/11 (Bárbara): o link entregou o contrato gerado pelo portal (PDF de ~252 KB). No 1º toque deu erro porque o link tentou gerar em paralelo com a geração pedida ao tocar em Verificar (dois logins da mesma pessoa no portal ao mesmo tempo).
- Agora há trava na fila (`contrato_gerando_ate`, 90 s): uma geração por vez. O link aberto durante a geração espera o PDF ficar pronto (até ~40 s); se ainda não ficou, mostra "Estamos gerando o seu contrato" e a página se atualiza sozinha a cada 6 s. Falha passageira: a página tenta de novo em 20 s. 183 testes. O JSON da WABA não muda.

# Versão 2.9.0 — Etapa 3: Contrato (igual ao site) e status salvo do portal

- **Contrato (passo 300669, conferido ao vivo em 16/11):** quando a próxima etapa do portal é **Contrato**, o botão do Portal (**Verificar**) abre a tela `CONTR_TERMOS` com o texto do site ("Termos da sua matrícula", download, assinatura no GOV.BR, envio para centraldematriculaub@unibalsas.edu.br, WhatsApp (99) 99131-1684) e **Fechar**.
- **"Baixar o contrato (PDF)"** abre um link exclusivo do Cloud Run (`GET /contrato/<token>`, vale 24 h, coleção `contratoLinks`). Ao abrir, o Run faz o que o navegador faz (`api/portal-site.js`): `login-portal` → `register-portal-data` → `getApplymentDataByStep/300669` → `button-click` do botão "Clique aqui para fazer o download do contrato" (aceite 38635 = false, data 38636 = "", **IP de aceite 52136 = IP de quem abriu o link**) → `popup` 765 "Contrato gerado" → PDF em base64 no campo **52138**. O PDF é devolvido na hora e não fica guardado. Leva ~20–30 s (o portal demora no `register-portal-data`). Logs `etapa3_contrato` / `etapa3_contrato_erro`.
- **Contrato processado no Cloud Run (segundo plano):** depois dos documentos entregues, o worker agenda o **vigia** (`tipo: etapa3_vigia`, a cada 10 min por até 15 dias, `ETAPA3_VIGIA_INTERVALO_S`). Quando a equipe aprova os documentos e o portal libera o Contrato, o vigia espera ~2 min (`ETAPA3_CALMA_MS`) para o Rubeus terminar de processar e então gera o contrato no portal e guarda o PDF criptografado no Firestore (`contratos`, 7 dias). O link abre o PDF **na hora**; só sem PDF pronto o Run gera no momento (reserva). Ao entrar com o contrato liberado e sem PDF pronto, o Flow já agenda a geração na hora (`tipo: etapa3_gerar`, sem a calma). Em segundo plano o IP de aceite vai vazio (não há navegador do candidato). O aviso ao candidato fica para depois.
- **Status salvo do portal:** o último status lido (no login ou pelo worker) fica na fila (`ultimo_status`, válido 6 h). Se o portal não responde a tempo no login, o Flow usa o status salvo; sem status, mostra "Estamos buscando a situação da sua inscrição…" com **Atualizar** e agenda a leitura em segundo plano (`tipo: etapa2_status`). O Flow não decide mais a etapa só pelo Firestore.
- Novo JSON (tela `CONTR_TERMOS`): **colar na WABA**. 182 testes.

# Versão 2.8.3 — Portal: etapa de documentos sempre leva às telas de documentos

- Quando o portal aponta "Documentos matrícula" como próxima etapa e o Flow ainda não recebeu os documentos, o botão leva às telas de documentos (antes uma linha "documentos" marcada como concluída podia trocar o botão por Fechar).
- Log `portal_destino` no login (sem dados pessoais): próxima etapa do portal, cada etapa com C (concluída) / P (passo) / A (ação), destino do botão e blocos já gravados.

# Versão 2.8.2 — Diagnóstico do arquivo do WhatsApp

- O envio pelo site chegou ao passo de documentos (login, processo e passo com HTTP 200), mas o arquivo do DocumentPicker falhou ao baixar/decifrar ("Arquivo inválido"). Novo log `midia_download` (sem segredos): em que etapa falhou (url, baixar, http, decifrar), host, HTTP, tamanho baixado, tipo da resposta, nomes dos campos e **tamanhos** dos campos de criptografia. Download com até 20 s.

# Versão 2.8.1 — Escola não trava a identidade

- "Buscar escola" sem a lista em cache tentava carregar do Rubeus ao vivo (login + portal, mais de 10 s) e o WhatsApp ficava girando. Agora tenta no máximo 5 s e libera a tela com aviso.
- Nome digitado sem escolher na lista segue, como antes: vai o nome, e o worker procura no formulário do Rubeus. Escolhida na lista: vai o código.

# Versão 2.8.0 — Documentos de matrícula pelo mesmo caminho do site

- **Por quê:** a API da UniBalsas (`/blip/inscritos`) não encontra candidatos de 2027/1 que ainda não estão no RM (404 em 223–226) e cobre os documentos de **inscrição**, não os de matrícula. O site grava os de matrícula pelo passo do Rubeus (300671 → SDOCALUNO).
- **Como (igual ao site, `api/portal-site.js`):** `vestibular.unibalsas.edu.br/api/applyment/` → `settings` (token) → `login-portal` (CPF + nascimento DDMMAAAA, sem captcha) → `register-portal-data` (processo da inscrição; o site leva ~16 s) → `getApplymentDataByStep/{passo}` (componente de upload, botão que grava, lista com CHAVERM) → **um único `button-click` multipart** com `file_0…file_n` e, no campo 38733, a lista dos documentos (`files:[{}]`, `value:["file_k"]` nos enviados). Depois relê o passo e registra se cada documento ficou em análise (`documento_enviado`, `conferido`).
- Documento que o portal já mostra como enviado (em análise/aceito) não é reenviado (`documento_ja_no_portal`). IDs de passo, botão e componente são lidos do passo (servem para os 4 processos).
- `processoseletivo.azurewebsites.net` (tentado na 1.6) bloqueia acesso de fora do site; o caminho certo é o domínio do vestibular.
- Logs `portal_site` (rota, HTTP, success, ms; sem CPF, token ou sessão). 177 testes.

# Versão 2.7.1 — Documentos da etapa 2: idps correto; status do portal no login

- **Correção:** os documentos iam para `/blip/inscritos/0/<cpf>` (HTTP 400): o id de processo que o portal devolve no login do candidato não está na tabela de processos. Agora, fora da tabela, o worker segue o fluxo da UniBalsas (e-mail do T.I. de 30/10, artigos 743–746): `GET /blip/processos-seletivos/{cpf}` → IDPS → `GET /blip/inscritos/{idps}/{cpf}`, tentando primeiro os IDPS do CPF que são processos conhecidos e, por garantia, 223/224/225/226, grava o encontrado na fila (`idps`) e nunca chama a API com 0 (log `idps_desconhecido` com o id real do portal).
- **Fila que falhou reabre ao entrar de novo** pelo LOGIN (zera tentativas e agenda o worker): os documentos guardados seguem sozinhos.
- **Status no login:** espera pelo portal de até 7,5 s contando o login (`ETAPA2_ESPERA_PORTAL_MS`); antes era 4,5 s e nunca bastava.
- 176 testes.

# Versão 2.7.0 — Etapa 2: portal como tela inicial do LOGIN, busca de escola e menor de idade

- **LOGIN → Portal do candidato:** todo login cai no status das etapas (como o site). O botão leva à primeira subetapa que falta (pelo Firestore e pelo que o portal já mostra como concluído), com o texto do botão do site. "Aguardando correção", documentos em análise e etapas ainda fora do Flow (contrato, pagamento) mostram o status e o botão **Fechar**. Prova liberada continua indo à redação.
- **Escola de Ensino Médio:** no site é uma lista fechada (~1.461 escolas, opcional). No Flow: digita parte do nome → **Buscar escola** → escolhe na lista (até 15) ou "Não encontrei a minha escola" (fica em branco). A lista fica em cache no Firestore (`flowCache/escolas-ensino-medio`, 7 dias), aquecida pelo worker ao abrir a identidade; sem cache, a busca abre a identidade no Rubeus uma vez. O worker envia o código da escola escolhida.
- **Menor de 18:** pula a pergunta "Eu/Outro" e vai direto à ficha do responsável financeiro ("Outro" é gravado sozinho).
- 175 testes. **Colar o JSON novo na WABA.**

# Versão 2.5.0 — Um único Flow: inscrição (etapa 1) + matrícula e documentos (etapa 2)

- `flows/etapa1-vestibular.json` agora tem as duas etapas. A etapa 1 não mudou (só a tela inicial ganhou o link **"Já sou inscrito (LOGIN)"**). O `flows/etapa2-matricula.json` separado deixou de existir.
- **Etapa 2:** login por CPF + data de nascimento (única consulta em tempo real) → situação das etapas → responsável financeiro → dados do responsável (se "Outro" ou menor de 18) → endereço (CEP ao vivo) → identidade → documentos de matrícula (um por tela, 3 obrigatórios) → mensagem do site ("em análise… até 48 horas úteis") e o Flow fecha. Cada tela grava no Firestore (`matriculaFila`) e responde na hora.
- **Worker:** envia cada subetapa ao Rubeus na ordem do portal; os documentos vão por último, com calma (`ETAPA2_ESPERA_DOCS_MS`, padrão 2 min depois da identidade), pela API da UniBalsas (`/blip/documents`). Depois do envio, as referências dos arquivos são apagadas.
- Logos comprimidos (16 cores): o Flow com as duas etapas ficou com ~218 KB. 171 testes.

# Versão 2.4.0 — Etapa 2 (matrícula) pelo Flow `flows/etapa2-matricula.json`

- **Diagnóstico (site/mapeamento):** cada subetapa é um passo próprio no Rubeus, com o seu botão — responsável financeiro (300676), dados do responsável (300668/300675), endereço (300666), identidade (300667, gera o RA), cupom (300674) — e o Rubeus só libera um passo depois que o anterior foi gravado. Envio **incremental e em ordem**.
- **Flow (telas `MATR_*`, logos no topo):** login (CPF + data de nascimento, como no Portal do candidato) → situação das etapas → responsável financeiro → dados do responsável (se "Outro" ou menor de 18) → endereço (busca pelo CEP) → identidade → fim (o passo de cupom do processo não é usado pela UniBalsas; se o portal pedir, o worker segue sem cupom). Cada tela grava no Firestore (`matriculaFila`) e responde na hora. Ao vivo só o login e o CEP.
- **Worker (`tipo: etapa2`):** entra no Rubeus com o CPF/nascimento guardados, pergunta ao portal o próximo passo, envia o bloco correspondente (convertendo UF, cidade natal, cor/raça, estado civil e escola para os códigos do formulário) e segue; passo sem bloco ainda = espera. Opção não encontrada = `conferir` (log `etapa2_fila_atencao`).
- RG passa a ir **como digitado** (o RM aceita letras), como no site.
- Mesmo endpoint `/api/flow`. Flow novo na WABA: abrir em `MATR_INICIO` sem pedir dados na primeira tela. 170 testes.

# Versão 2.0.0 — Etapas independentes: o Cloud Run confirma na hora e o Rubeus é processado em segundo plano

- **Etapa 1 (Flow `flows/etapa1-vestibular.json`, telas `INSC_*`):** processo → dados básicos → curso e turno → informações complementares (+ notas do ENEM). Cada tela grava no Firestore (`inscricoesFila`) e agenda o worker. Ao tocar **Concluir**, o `/api/flow` valida, grava, agenda e **fecha o Flow na hora** (`SUCCESS`, `response_json`: `status: "dados_recebidos"`, `protocolo_fila`). Sem telas de "Verificar andamento".
- **Worker (`/internal/flow-worker`):** grava no Rubeus passo a passo (todos os processos). Vestibular: deixa a prova vinculada (pré-carga do "Iniciar prova", sem `create/`, que inicia o cronômetro de 2 h) e manda o aviso da etapa 2 pelo Blip, com um link (`flow_token`) novo. Transferência, Portador e ENEM terminam na inscrição confirmada.
- **Etapa 2 (redação):** o `INIT` do `/api/flow` com o `flow_token` do aviso abre direto `INSC_REDACAO`, com o tema. **Enviar redação** grava, agenda e fecha o Flow na hora (`status: "redacao_recebida"`); o worker abre a prova, envia e confirma no portal.
- **Variáveis no Cloud Run:** `BLIP_API_URL`, `BLIP_BOT_KEY`, `BLIP_TEMPLATE_REDACAO` (obrigatórias para o aviso); `BLIP_FLOW_ID`, `BLIP_STATE_ID`, `BLIP_MASTERSTATE` (opcionais). Sem elas o aviso não sai e o log mostra `blip_aviso` `nao_configurado`.
- **Meta:** republicar `flows/etapa1-vestibular.json` (a tela de orientação saiu; as notas do ENEM entraram). O `flow-waba.json` (Flow antigo) não muda. 163 testes. Versão esperada: `unibalsas-cloudrun-jornada-2.0.0`.

# Versão 1.9.0 — Flow da inscrição grava no Google e o Cloud Run grava no Rubeus em segundo plano

- Cada tela do Flow `INSC_*` grava as respostas no Firestore (`inscricoesFila`) e responde na hora. O worker do Cloud Run vai gravando no Rubeus passo a passo (dados básicos → curso/turno → conclusão → prova → redação), só até onde o candidato já preencheu, enquanto ele segue nas próximas telas.
- Não depende de cache pronto: na primeira inscrição, a tela de curso espera (até 6 s) o worker trazer cursos e turnos do Rubeus; o tema da redação é trazido quando o candidato toca em Iniciar prova. Depois tudo fica guardado e as telas abrem na hora.
- Mesmo endpoint `/api/flow`. Abrir o Flow direto em `INSC_INICIO` (sem pedir dados na primeira tela). O `flows/etapa1-vestibular.json` não mudou.
- 160 testes. Versão esperada no `GET /api/flow`: `unibalsas-cloudrun-jornada-1.9.0`.

# Versão 1.8.0 — Flow próprio da etapa 1 do Vestibular (`flows/etapa1-vestibular.json`)

- **Flow novo na WABA**, separado do atual: `flows/etapa1-vestibular.json` (gerado por `node flows/gerar-etapa1.mjs`). Telas: `INSC_INICIO` → `INSC_DADOS` → `INSC_CURSO` (curso e turno na mesma tela) → `INSC_QUASE_LA` → `INSC_ORIENTACAO` → `INSC_REDACAO` → `INSC_FIM`. Sem login, sem matrícula, sem telas de "Verificar andamento".
- **Endpoint próprio:** no Flow novo da WABA, a URL do endpoint é `https://<serviço>.run.app/api/flow/etapa1` (o Flow antigo continua em `/api/flow`). O INIT abre `INSC_INICIO`.
- Sempre em modo fila (a chave `ETAPA1_FILA` vale só para o Flow antigo). Processo: `ETAPA1_PROCESSO` (padrão `20383`).
- Precisa do cache completo (cursos, turnos e tema; vale 30 dias, renovado a cada inscrição). Sem cache, `INSC_INICIO` encerra com aviso e o log `etapa1_fila_atencao` (`cache_indisponivel`). O cache é aquecido por uma inscrição pelo Flow antigo que chegue à redação e é renovado pelo worker a cada envio.
- 158 testes (inclui o contrato do JSON: chaves e tipos de cada resposta iguais às declaradas). Versão esperada no `GET /api/flow`: `unibalsas-cloudrun-jornada-1.8.0`.

# Versão 1.7.0 — Etapa 1 do Vestibular em modo fila (Flow instantâneo)

- **Desligado por padrão.** Liga com a variável `ETAPA1_FILA=on` no Cloud Run (desliga voltando para `off`, sem novo deploy).
- Com o modo fila ligado e o cache completo, as telas de dados básicos, curso, "Estamos quase lá", abrir e enviar a redação respondem na hora, sem esperar o Rubeus. As respostas são conferidas com as mesmas regras do caminho de sempre.
- Ao concluir a inscrição, os dados ficam guardados no Firestore (coleção `inscricoesFila`, criptografados) e um worker do Cloud Run repete no Rubeus exatamente os passos do caminho síncrono, conferindo cada tela. A redação é enviada assim que o candidato a entrega. Depois da entrega confirmada, os dados pessoais e o texto são apagados do registro.
- Cache (coleção `flowCache`): cursos, turnos de todos os cursos e tema da redação. É aquecido pelo caminho síncrono (o primeiro candidato após ligar usa o caminho de sempre) e renovado pelo worker a cada 6 h. Sem cache completo, o Flow usa o caminho de sempre.
- Duplicidade: consulta rápida na API da UniBalsas (`/blip/inscritos`, 2,5 s; `ETAPA1_CONSULTA_RM=off` desliga) e na própria fila; mostra a mensagem do site. Se o Rubeus acusar no envio, a inscrição fica `duplicada`.
- Falhas: antes da conclusão, nova tentativa automática numa sessão nova (até 6, com espera crescente). Envio sem confirmação (conclusão ou redação) nunca é repetido: fica `conferir`. Logs: `etapa1_fila`, `etapa1_fila_erro`, `etapa1_fila_atencao` (erro, para a equipe), `etapa1_cache`.
- O `flow-waba.json` não muda. 155 testes. Versão esperada no `GET /api/flow`: `unibalsas-cloudrun-jornada-1.7.0`.

# Versão 1.6.17 — Redação pré-carregada ao concluir a inscrição (Vestibular)

O Rubeus gera o código da execução da prova (IDEXECPROVA) alguns segundos depois do "Iniciar prova", e o "Iniciar redação" esperava ou voltava para a orientação. Agora, no mesmo job que conclui a inscrição:

- **Pré-carga:** aciona o "Iniciar prova", espera o código da execução (relendo o formulário, sem novo envio) e monta o link da avaliação. **Não** abre a avaliação (`create/`), que é o que inicia o cronômetro de 2 h.
- **Iniciar redação** usa a prova pronta: só confere o vínculo e abre o tema, sem acionar o botão de novo.
- **Falhas não derrubam a inscrição:** antes do "Iniciar prova", o toque segue o caminho normal; depois, o próximo toque só confere a prova existente (`conferir_prova_existente`).
- Também desde a 1.6.16: espera do IDEXECPROVA (até 6 releituras de 2 s), tela de curso sem turno/oferta do curso anterior, listas sem opções repetidas, logs `flow_client_error` e `turnos_carregados`.
- Logs: `redacao_pre_carregada` (ms) e `redacao_pre_carga_falhou` (`enviado`, mensagem). Desligar: `PRECARREGAR_REDACAO=off`.
- Somente servidor; o `flow-waba.json` não muda. 148 testes. Versão esperada no `GET /api/flow`: `unibalsas-cloudrun-jornada-1.6.17`.

---
# Versão 1.6.16 — CEP no endereço, CPF da sessão protegido e orientação do contrato

Correções P1 do mapeamento de 10–12/11/2026 (`MAPA-JORNADA-2027.md`). **Somente servidor; o `flow-waba.json` não muda** (a tela já enviava `cep`).

- **CEP no endereço:** o site envia o CEP (campo 38568, só dígitos) no passo de endereço; o Flow pedia o CEP mas não gravava. Agora vai no endereço do candidato e, quando o formulário tiver o campo "CEP", no endereço do responsável. CEP com menos de 8 números é recusado antes de gravar.
- **CPF da sessão protegido:** o Flow roda no Blip, sem a assinatura da Meta (`META_APP_SECRET`). Depois do login, um `cpf` vindo do cliente não troca mais o CPF do candidato no estado selado; ele fica em `cpf_informado` e só é usado como CPF do responsável financeiro. Em erro, a tela reexibe o CPF digitado.
- **Contrato:** o texto dizia "registre o seu aceite no Portal". O site não tem aceite: o candidato baixa o contrato, assina pelo GOV.BR e envia à central de matrícula por e-mail. O link abre o passo do contrato. Texto de documentos corrigido para "até 5 MB por arquivo".
- **Não feito:** entregar o PDF do contrato dentro do WhatsApp (precisa enviar mensagem com anexo pelo Blip) e enviar a idade (38704).
- 137 testes locais (`test/p1-correcoes.test.js`). Versão esperada no `GET /api/flow`: `unibalsas-cloudrun-jornada-1.6.16`.

---
# Versão 1.6.15 — API da UniBalsas sem depender do processo na sessão

Logs reais da 1.6.14 (documento 46): `matricula_doc_via` mostrou `idps: null`, `processo: null`, `cpf_digitos: 11` — a sessão de "Já sou inscrito" não traz o processo, então a API documentada nunca era tentada. Os controles sem arquivo (campo vazio e sem campos) também deram HTTP 500: o botão 3940449 quebra no `/submit` oficial do Rubeus com qualquer corpo.

- Sem processo na sessão, o servidor procura a inscrição do CPF em cada IDPS conhecido (`223`, `226`, `225`, `224`, lista em `processes.js`) e grava no primeiro em que `/blip/inscritos/{idps}/{cpf}` a encontrar. Erro diferente de "inscrição não encontrada" encerra a busca (o envio pode ter chegado ao RM) e cai no Rubeus.
- `matricula_doc_via` agora também registra `candidatos`. 128 testes. Versão esperada: `unibalsas-cloudrun-jornada-1.6.15`.

---
# Versão 1.6.14 — Log `matricula_doc_via` (por que a API da UniBalsas não foi usada)

No teste da 1.6.13 (documento 16, JPEG) não apareceu `matricula_doc_api_unibalsas`: o envio foi direto ao Rubeus, então `canApi` deu falso (sem `idps` do processo ou sem CPF de 11 dígitos no estado). O novo evento `matricula_doc_via` registra `canApi`, `apiFirst`, `tem_saveDocument`, `idps`, `processo` e `cpf_digitos` (só o tamanho do CPF) em todo envio de matrícula. 126 testes. Versão esperada: `unibalsas-cloudrun-jornada-1.6.14`.

---
# Versão 1.6.13 — API documentada da UniBalsas no envio de matrícula + sondagem sem arquivo

Logs reais da 1.6.12: os 4 formatos no campo de upload do Rubeus deram HTTP 500 (não JSON), idênticos. Os artigos 743-746 da central de ajuda documentam o caminho "oficial" da UniBalsas: `GET /blip/processos-seletivos/{cpf}` → `GET /blip/inscritos/{idps}/{cpf}` → `GET /rm/documents` → `POST /blip/documents` (grava no DataServer `EduPSDocumentoEntregueData`; não citam SDOCALUNO nem matrícula).

- No envio de "Documentos matrícula" o servidor agora tenta **primeiro** a API documentada (mesma função `saveDocument` das inscrições, com `idps` do processo e `codDocumento` = código do documento) e, se falhar, o envio oficial do Rubeus. `MATRICULA_DOC_VIA=rubeus,unibalsas` inverte a ordem. Log: `matricula_doc_api_unibalsas` (ok/erro, mensagem).
- **Sondagem sem arquivo** (uma vez por instância, só se o Rubeus recusar): envia o botão 3940449 com o campo vazio e sem campos. Log `matricula_doc_controle`: se vier erro de validação em JSON, o 500 depende do conteúdo; se vier 500 de novo, o botão quebra via API. `MATRICULA_CONTROL=off` desliga.
- **Não verificado:** se um documento gravado por `/blip/documents` aparece no Portal do candidato como "Em análise" no passo de matrícula (o Portal grava em SDOCALUNO; a API grava em `EduPSDocumentoEntregue`) e se o RM aceita códigos de documento que `/rm/documents` não lista para o Vestibular (retorna vazio no idps 223).
- 126 testes locais. Versão esperada no `GET /api/flow`: `unibalsas-cloudrun-jornada-1.6.13`.

---
# Versão 1.6.12 — Envio oficial: testa formatos do arquivo no campo de upload

Logs reais da 1.6.11 (WhatsApp, PDF e JPEG da Nicole): o arquivo chega e é lido (`matricula_doc_lido`), mas o `/submit` oficial respondeu HTTP 500 com os campos 38730/38731/38733/38718, que **não existem** no formulário oficial (só o componente `3940446`, tipo `upload`). A API interna do portal respondeu 403 com página HTML da Azure (bloqueio da plataforma): abandonada.

- O arquivo agora vai no campo de upload do formulário, testando um formato por vez, na ordem: `formio` (lista de arquivos Form.io com `url` data-URL), `lista` (7 documentos com `component_id`, como o portal monta), `dataurl` e `base64`. O primeiro aceito vira o primeiro da fila nas próximas vezes (por instância).
- Cada tentativa vai para o log: `matricula_doc_tentativa` (`mode`, `ok`, mensagem). Se nenhuma for aceita: `matricula_doc_rejeitado` com a lista de tentativas.
- `MATRICULA_SUBMIT_MODE` (ex.: `formio,dataurl`) limita e ordena os formatos. Sem o campo `upload` no formulário, mantém o envio antigo pelos campos do RM.
- Atenção: uma tentativa "aceita" só vale se o documento aparecer no Portal do candidato como "Em análise" (conferir sempre).
- 122 testes locais. Versão esperada no `GET /api/flow`: `unibalsas-cloudrun-jornada-1.6.12`.

---
# Versão 1.6.11 — Diagnósticos mais precisos (sondagem do portal e anexo)

Resultado dos logs da 1.6.10 na prévia da Meta: a sondagem da API interna do portal respondeu **HTTP 403** (sem JSON) e o anexo simulado da prévia chegou sem endereço `https` válido (`cdn_host: null`), com a estrutura correta (`media_id`, `file_name`, `cdn_url`, `encryption_metadata`).

- A sondagem agora envia `Origin`/`Referer` do site do vestibular e, quando a resposta não for 200/JSON, registra `matricula_portal_probe_resposta` (servidor, tipo e início do texto do erro).
- `matricula_doc_recebido` passa a registrar o tamanho do `cdn_url` e, se não for endereço válido, os 12 primeiros caracteres.
- 120 testes locais. Versão esperada no `GET /api/flow`: `unibalsas-cloudrun-jornada-1.6.11`.

---
# Versão 1.6.10 — Sondagem da API interna do portal (só leitura)

O log da 1.6.9 mostrou que o formulário **oficial** do passo 300671 só tem o campo `3940446` (tipo `upload`) e os botões 3940448 (Portal) e 3940449 (Enviar): os campos 38730/38731/38733/38718 do envio da 1.6.9 não existem nele. O portal envia o arquivo por `POST /api/applyment/button-click` (multipart) usando só o `token` no corpo.

- Ao abrir "Documentos matrícula", o servidor faz uma consulta **só de leitura** a `getApplymentDataByStep/{passo}` na API interna do portal com o `token` do Flow e registra `matricula_portal_probe` (http, success, nomes de campos, contagem de linhas de documento; sem valores). Desliga com `PORTAL_PROBE=off`.
- Se o token do Flow valer lá, o próximo passo é o envio por `button-click` (multipart) como o site faz.
- 120 testes locais. Log `matricula_doc_recebido` (formato do anexo), `matricula_doc_leitura_falhou` e `matricula_doc_lido`. Versão esperada no `GET /api/flow`: `unibalsas-cloudrun-jornada-1.6.10`.

---
# Versão 1.6.9 — Documentos de matrícula (Vestibular) pelo DocumentPicker, via API oficial do Rubeus

Resultado da engenharia reversa (`ENGENHARIA-REVERSA-VESTIBULAR-DOCUMENTOS-MATRICULA.md`): o passo "Documentos matrícula" (300671) é um formulário Rubeus cujo botão 3940449 grava o arquivo na tabela SDOCALUNO do RM. O Cloud Run, que já faz o login no Rubeus, agora faz o mesmo envio.

- Depois do login ("Já sou inscrito"), o hub abre a tela `DOCUMENTOS_INSCRICAO` no modo matrícula: 7 documentos (Histórico, Certificado e Declaração de conclusão são **obrigatórios**; Identidade, CPF, Comprovante de residência e Responsável financeiro são opcionais). Progresso "N de 3 obrigatórios enviados".
- O arquivo do DocumentPicker é decifrado, validado (PDF/JPG/PNG, até 740 KB) e enviado no `/submit` do botão 3940449 (campos 38730 arquivo, 38731 nome, 38733 código, 38718 chave RM). Os campos técnicos do formulário são preservados e o token novo do Rubeus é reaproveitado.
- **Rede de segurança:** se o formulário não tiver o botão/campos esperados, ou com `MATRICULA_DOCS_UPLOAD=off` no Cloud Run, a etapa abre o Portal como antes (ETAPA_PORTAL).
- O Flow só tem rotas para frente: vindo de Identidade na mesma sessão o Flow encerra com a situação; o candidato retoma por "Já sou inscrito".
- `flow-waba.json` **não mudou** (reaproveita a tela de documentos da 1.6.6). 120 testes locais. Log `matricula_doc_recebido` (formato do anexo), `matricula_doc_leitura_falhou` e `matricula_doc_lido`. Versão esperada no `GET /api/flow`: `unibalsas-cloudrun-jornada-1.6.10`.
- **Não verificado em produção:** se o `/submit` oficial grava o arquivo no RM. Ao abrir a etapa o servidor loga `matricula_docs_form` (campos e botões, sem valores); no envio, `matricula_doc_enviado` ou `matricula_doc_rejeitado`. Testar com o cadastro fictício antes de liberar.

---
# Versão 1.6.8 — Ano de conclusão digitado e obrigatório (Identidade)

Na etapa **Identidade** o campo "Ano de conclusão" vinha como lista e abria vazio (a consulta do Rubeus não devolve os anos). Agora é um campo de texto de 4 caracteres, **obrigatório**.

- Servidor: exige 4 números entre 1950 e o ano atual e grava no campo do formulário do Rubeus. Se a etapa não tiver esse campo, não bloqueia.
- `flow-waba.json`: o Dropdown virou `TextInput` (texto, `min-chars`/`max-chars` 4, obrigatório); o dado `anos` saiu da tela. É texto (não numérico) para manter o valor digitado quando a tela recarrega (ex.: Buscar escola).
- 108 testes locais. **Atualizar servidor e JSON juntos.** Versão esperada no `GET /api/flow`: `unibalsas-cloudrun-jornada-1.6.8`.

---
# Versão 1.6.7 — Corrige a importação do Flow na Meta

A Meta recusou o `flow-waba.json` da 1.6.6: `Wrong positioning of operator '&&'. It cannot be used in concatenation with '=='` (tela `DOCUMENTOS_INSCRICAO`). Condições do `If` não aceitam `&&` junto com `==`.

- O servidor passa a enviar `mostrar_envio` e `mostrar_concluido` (booleanos já resolvidos, desligados enquanto a tela processa) e o JSON usa só `${data.mostrar_envio}`, `${data.mostrar_concluido}` e `${data.processando} == true`.
- Teste novo falha se qualquer condição do Flow voltar a usar `&&` ou `||`.
- **Servidor e JSON precisam ser atualizados juntos**: o JSON novo depende dos dois campos novos. 106 testes locais. Versão esperada no `GET /api/flow`: `unibalsas-cloudrun-jornada-1.6.7`.

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

104 testes locais (inclui `dropdown-options.test.js` e `documentos-progresso.test.js`). Não testado: prévia/aparelho real, nem o envio de arquivo pelo Flow rodando no Blip. Ver `CHECKLIST-TESTES-1.6.6.md` e `ENGENHARIA-REVERSA-TRANSFERENCIA-DOCUMENTOS.md`. Versão esperada no `GET /api/flow`: `unibalsas-cloudrun-jornada-1.6.6`.

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
