# Versão 2.17.3 — sessão expirada no meio das tentativas (20/11/2026) — só servidor

- A sessão do Rubeus guardada no registro (estado selado) vale 3 h; com 72 h de tentativas ela podia vencer e as tentativas seguintes falhavam sempre.
- Antes da conclusão: sessão vencida recomeça numa sessão nova, sem contar como falha.
- Redação ainda não enviada (redacao_enviar): volta para `redacao`, que entra de novo no Rubeus com o CPF e a data de nascimento guardados (como o LOGIN) e abre a mesma prova.
- Redação já enviada, só faltando a confirmação (`entrega`): vai direto para a equipe conferir (`entrega_sem_sessao`), sem reenvio e sem 72 h de tentativas inúteis.
- Teste novo (falha na 2.17.2, passa na 2.17.3).

# Versão 2.17.2 — resposta incompleta do portal nunca vira "concluída" (20/11/2026) — só servidor

- **Matrícula:** etapas vazias no portal → tenta de novo (motivo `portal_vazio`); botão de etapa em formato desconhecido → equipe confere (`portal_formato`). Antes, os dois casos davam "concluída" sem enviar os blocos.
- **Documentos de inscrição:** "já em análise" só quando a etapa não tem botão (ou tem o link de situação `feedback/<n>`). Botão em formato desconhecido → equipe confere; "Pendentes" sem botão → espera o portal. Os arquivos ficam guardados.
- Formatos aceitos (`linkDesconhecido` em `api/portal-site.js`): `presencial/passo/<n>` e `presencial/feedback/<n>`, os únicos vistos no portal (conferido de novo em 20/11 com Juan e Rebeca: nenhum link fora desses).
- Testes novos nos dois casos (falham na 2.17.1, passam na 2.17.2).

# Versão 2.17.1 — reenvio ao Rubeus por até 72 h (20/11/2026) — só servidor, JSON igual à 2.16.23

- **Motivo (auditoria do GPT, 20/11):** o worker desistia depois de 6 falhas (~15 min: 30 s, 1, 2, 4, 8 min) e a contagem não zerava com sucesso; um Rubeus fora do ar por mais de 15 min deixava a inscrição em "falhou" sem retomada.
- **Ritmo novo** (`api/retentativas.js`, inscrição/redação/documentos de inscrição e matrícula): 1ª tentativa 10 s depois de os dados chegarem; em falha 30 s, 2 min, 30 min, 30 min, 1 h da 6ª à 10ª e 6 h 35 min 44 s da 11ª à 20ª = 72 h. Depois da 20ª, "falhou" com os dados guardados no Firestore e alerta para a equipe.
- **Contagem zera:** quando o passo que falhou dá certo (etapa 1) ou um bloco é gravado (matrícula). A espera pelo portal ("Documentos inscrição") tem contagem própria.
- O Run continua desligado entre as tentativas (tarefas agendadas no Cloud Tasks). Vigias, avisos e cobrança do Blip não mudaram.
- Testes novos: soma de 72 h, 20 tentativas no ritmo novo terminando em "falhou" com os dados guardados, e contagem zerada depois do sucesso.

# Versão 2.17.0 — inscrição homologada nos 4 processos no app e no WhatsApp Web; limpeza do Run (20/11/2026) — só servidor, JSON igual à 2.16.23

- **Homologação (20/11):** Vestibular, Transferência, Portador e ENEM chegaram ao fim da inscrição no WhatsApp Web; notas do ENEM conferidas no portal. Causa do problema no Web: o CalendarPicker da tela de Dados básicos (a 2.16.23 voltou o If do nome social e continuou passando). Regras em README › "Regras do Flow para funcionar também no WhatsApp Web".
- **Limpeza:** saíram o pré-carregamento dos turnos de todos os cursos (turnosDeTodos/aquecer, ~11 consultas ao Rubeus a cada 6 h) e a espera do cache na tela de curso (esperarCache): com os cursos fixos, o worker consulta só o turno do curso escolhido. O cache guarda o tema da redação e a lista de cursos do Rubeus (reserva do worker).
- README revisto: cursos fixos, regras do Web, tempos de cada etapa, ritmo dos vigias e avisos, Cloud Run e variáveis que o código usa de fato (BLIP_TEMPLATE_REDACAO não existe mais; entram BLIP_FLOW_ID, BLIP_STATE_ID, BLIP_MASTERSTATE, BLIP_TEMPLATE_*, AVISOS_DESLIGADOS).
- Scripts de verificação local (.claude/skills/verify) no caminho novo do curso (um toque, sem turno).
- Teste novo: sem cache, Transferência/Portador/ENEM acham curso e turno na tela de curso do processo (CURSO_INGRESSO).

# Versão 2.16.23 — nome social volta a aparecer só com a caixa marcada (teste do calendário) (20/11/2026) — COLAR O JSON NOVO NA META

- 2.16.22 passou no WhatsApp Web (Vestibular 02:14 e Transferência 02:16): escolher_curso chegou ao Run e o worker achou curso e turno no Rubeus. Mudanças da 2.16.22: CalendarPicker → DatePicker e If do nome social removido.
- Pedido do usuário: o nome social volta a aparecer só quando marca "Possuo nome social" (If de volta). O DatePicker continua. Se passar no Web, a causa era o CalendarPicker; se falhar, era o If.
- Estética da lista de cursos (pedido do usuário): nome do curso no título ("MEDICINA VETERINÁRIA") e o turno no subtítulo ("Turno: Integral"). A lógica não muda: o worker usa busca e turno do catálogo.

# Versão 2.16.22 — Dados básicos sem calendário e sem If (teste do WhatsApp Web) (20/11/2026) — COLAR O JSON NOVO NA META

- Teste da 2.16.21 no Web: com a tela de curso sem nada do servidor (lista fixa, sem If, sem on-select), a passagem Dados básicos → Curso continuou falhando na 1ª passada (02:03:50 tela de curso; 02:03:53 e1_iniciar da 1ª tela). As outras passagens funcionam, então o suspeito é a tela de Dados básicos.
- Dados básicos: CalendarPicker trocado por DatePicker (seletor clássico, AAAA-MM-DD) e o If do nome social removido (campo "Nome social (opcional)" sempre visível; o Run continua exigindo quando a caixa está marcada).
- Rótulos de lista com até 20 caracteres (aviso da Meta): "Processo seletivo", "Ano do ENEM", "Como nos conheceu?".

# Versão 2.16.21 — cursos fixos no Flow; o worker acha curso e turno no Rubeus (20/11/2026) — COLAR O JSON NOVO NA META

- **Causa do Web confirmada nos logs (20/11):** ao escolher o curso, o Run respondia com a mesma tela (INSC_CURSO) já com os turnos; o WhatsApp Web mostrava a 1ª tela em vez de redesenhar a tela de curso. Tocando de novo, a tela de curso aparecia certa. Só a etapa do curso fazia esse tipo de resposta.
- **Ideia do usuário:** os cursos não mudam no semestre, então ficam fixos no Flow (api/cursos-fixos.js): 11 cursos em botões de opção, com o turno no nome ("DIREITO - NOTURNO"; Med. Veterinária e Odontologia "INTEGRAL"). Escolher o curso não chama o Run; o Avançar grava a escolha e vai direto para "Estamos quase lá". A tela de curso abre na hora, sem esperar o Rubeus.
- **Worker:** no passo turnos, acha o curso do Rubeus pelo começo do nome na lista do processo, consulta os turnos e escolhe o turno pelo nome (NOTURNO/INTEGRAL). Guarda os códigos em rubeus_curso e envia. Curso que o Rubeus não tem no processo vai para "conferir" (motivo curso_indisponivel), sem enviar curso errado.
- Lista conferida no catálogo do Vestibular (19/11). Transferência mostrou os mesmos 11 cursos na tela; Portador e ENEM não foram conferidos.

# Versão 2.16.20 — Flow sem ciclo de rotas: "Leia mais" abre a página da LGPD (20/11/2026) — COLAR O JSON NOVO NA META

- Conferência do roteamento (rotas declaradas + botões navigate): o único ponto fora do padrão nas 35 telas era INSC_PRIVACIDADE, cujo "Voltar" navegava para INSC_DADOS sem rota declarada (ciclo Dados básicos → Privacidade → Dados básicos).
- O OptIn de privacidade agora usa open_url para https://lp.unibalsas.edu.br/lgpd/ e a tela INSC_PRIVACIDADE saiu (34 telas). Resto igual à 2.16.19.
- Hipótese a testar no WhatsApp Web: o ciclo não declarado atrapalha a navegação que o Web monta ao abrir o Flow (1ª passada erra o botão). Não comprovado.
- Teste novo: nenhum navigate sem rota declarada e nenhum ciclo no routing_model.

# Versão 2.16.19 — etapa 1 restaurada para a 2.16.8 (curso carrega o turno abaixo) (20/11/2026) — COLAR O JSON NOVO NA META

- A pedido do usuário, as telas e o servidor da etapa 1 voltaram à 2.16.8: ao escolher o curso, o turno carrega logo abaixo (lista com on-select-action), igual ao que funcionava no aplicativo.
- Mantida a correção da 2.16.10: documentos de inscrição esperam o portal (até ~24 h, a cada 10 min) e o log docs_portal_etapas.
- Desfeitas as tentativas para o WhatsApp Web (2.16.9, 2.16.11 a 2.16.18): tela de turno própria, turno no nome/descrição, botões de opção, caixa de marcar, logo fora do Form, listas validadas e logs flow_lista/flow_catalogo.
- Conclusão do teste no Web (19/11): o WhatsApp Web erra só na primeira passada depois de abrir o Flow (a tela seguinte herda o botão "Iniciar inscrição"); refazendo o caminho no mesmo Flow, Vestibular e Transferência passam. O servidor responde igual nos dois casos. Limitação do Web, não do Flow.

# Versão 2.16.18 — curso em caixa de marcar "CURSO - TURNO" e catálogo de cursos no log (19/11/2026) — COLAR O JSON NOVO NA META

- Ideia do usuário: curso em CheckboxGroup (mínimo 1; a Meta não aceita máximo 1, então o servidor recusa mais de um com \"Marque apenas um curso.\"), com o turno ao lado do nome: "DIREITO - NOTURNO". Acima de 30 caracteres, título cortado e o texto inteiro na descrição. O servidor aceita curso_id como lista (CheckboxGroup) ou texto.
- Log flow_catalogo (processo, id e nome dos cursos e turnos, sem dado pessoal) ao abrir a tela de curso. Serve para montar as listas fixas de cursos no JSON da WABA, por processo (próxima ideia do usuário).
- Situação do Web: a 2.16.17 continuou voltando ao início em 6 de 7 tentativas; a que passou (sessão 03c66a43) teve os Dados básicos recusados 2 vezes antes. Modo anônimo do navegador também falhou.

# Versão 2.16.17 — processo seletivo em botões de opção na 1ª tela (WhatsApp Web) (19/11/2026) — COLAR O JSON NOVO NA META

- Com a 2.16.16, a Transferência continuou voltando aos Dados básicos no Web, enquanto o Vestibular passa. As telas e a resposta do servidor são iguais nos 4 processos; a diferença está no Web antes do curso: a escolha do processo na lista da 1ª tela (Dropdown abre uma tela própria de seleção, que já se mostrou capaz de bagunçar a navigação do Web).
- A escolha do processo agora é botão de opção. Na inscrição não sobra nenhuma lista em tela própria; só as de UF (27) da matrícula continuam Dropdown.

# Versão 2.16.16 — rodapé da 1ª tela numa posição única (WhatsApp Web) (19/11/2026) — COLAR O JSON NOVO NA META

- Visto na tela (Transferência, Web): com os botões de opção a escolha do curso funciona, mas o rodapé da tela de curso aparece como "Iniciar inscrição" e, ao tocar, manda e1_iniciar (volta aos Dados básicos). A tela de curso tinha o rodapé na mesma posição da 1ª tela (6º item do Form); o Web reaproveitava o botão da 1ª tela, que fica embaixo na pilha.
- INSC_INICIO: logo saiu do Form, e o rodapé foi para uma posição que nenhuma outra tela usa. Aparência igual. Teste garante a posição única.

# Versão 2.16.15 — escolhas em botões de opção depois da 1ª tela (WhatsApp Web) (19/11/2026) — COLAR O JSON NOVO NA META

- **Causa confirmada no WhatsApp Web (Transferência, 19/11 ~18h):** a tela de curso abre certa (11 cursos com "Turno: Noturno"), mas ao escolher o curso na lista (Dropdown abre uma tela própria de seleção) o Web volta mostrando o conteúdo da 1ª tela ("Escolha seu processo…", Iniciar inscrição) debaixo do título "Curso de interesse". O rodapé já aparecia como "Iniciar inscrição" antes da escolha. Não é dado nem processo: a mesma resposta (2.236 bytes) passou uma vez no Vestibular.
- **Solução:** depois da 1ª tela, as escolhas são botões de opção (RadioButtonsGroup, ficam na própria tela, como Gênero): curso, ano do ENEM, turno, nacionalidade, "Como ficou sabendo", cor/raça e estado civil. Vale para os 4 processos.
- **Pendente:** as listas de UF (27 estados) da matrícula continuam Dropdown, porque botões de opção aceitam no máximo 20.
- Log flow_lista marca acima_de_20 quando uma lista do servidor passar de 20 opções. Teste garante que só a lista do processo (1ª tela) e as de UF são Dropdown.

# Versão 2.16.14 — listas validadas no servidor e diagnóstico da tela de curso (19/11/2026) — só servidor, JSON igual

- Teste da 2.16.13 no WhatsApp Web: a tela de curso chega (296 ms) e, ~3 s depois, o Flow volta ao início sem nenhum escolher_curso. A falha parece ser do Web ao exibir a tela, não do Avançar.
- proj() (opções enviadas às telas INSC_*) agora descarta opção sem id ou título e id repetido, corta título em 30 e descrição em 300 caracteres.
- Log flow_lista nas telas INSC_CURSO, INSC_CURSO_ENEM, INSC_TURNO e INSC_QUASE_LA: quantidade de opções, descartes, ids repetidos, maior título, maior descrição, tamanho do estado e da resposta. Sem conteúdo nem dados pessoais.

# Versão 2.16.13 — listas do servidor sem valor inicial (WhatsApp Web) e turno na descrição do curso (19/11/2026) — COLAR O JSON NOVO NA META

- **Causa provável do Web voltar à 1ª tela na escolha do curso:** a lista de cursos (opções vindas do servidor) começava com valor inicial vazio (`curso_id: ""`), que não está entre as opções. A lista do processo na 1ª tela, sem valor inicial, funciona no Web. Agora nenhuma lista com opções do servidor tem valor inicial: curso, turno, ano do ENEM, "Como ficou sabendo" (Estamos quase lá) e "Escola" (identidade). Um teste confere isso no Flow inteiro.
- **Nome do curso até 30 caracteres** (limite da Meta para opção de lista). Com turno único, a opção mostra "Turno: Noturno" na descrição. Nome maior que 30 é cortado com reticências e vai inteiro na descrição.
- O Avançar continua indo direto para "Estamos quase lá" com o turno único (2.16.12).

# Versão 2.16.12 — turno único no nome do curso, Avançar direto (19/11/2026) — COLAR O JSON NOVO NA META

- Hoje todos os cursos têm um turno só. A lista de cursos já mostra o turno no nome (ex.: "Direito — Noturno") e o Avançar grava curso + turno e vai direto para "Estamos quase lá". Uma tela, sem escolha de turno, sem If e sem on-select (funciona no WhatsApp Web).
- A tela INSC_TURNO (2.16.11) fica só para curso com mais de um turno.
- Rotas: INSC_CURSO e INSC_CURSO_ENEM → INSC_TURNO, INSC_QUASE_LA. Colar flows/etapa1-vestibular.json na Meta depois do deploy.

# Versão 2.16.11 — turno em tela própria: curso e turno funcionam no WhatsApp Web (19/11/2026) — COLAR O JSON NOVO NA META

- **Causa:** no WhatsApp Web, a tela de curso voltava para a 1ª tela ao tocar em Avançar, sem chamar o servidor. O turno ficava dentro de um If ainda não exibido, mas o init-values e o payload do Avançar já citavam turno_id. O app tolera isso; o Web não. Antes (2.16.8) o mesmo acontecia com on-select-action.
- **Agora:** INSC_CURSO só tem o curso (no ENEM, INSC_CURSO_ENEM tem curso + dados do ENEM, validados nesse Avançar). O Avançar abre a tela nova **INSC_TURNO** (nome do curso + lista de turnos; turno único já marcado), e o Avançar dela grava curso + turno (+ notas e média no ENEM) e segue para INSC_QUASE_LA. Sem If e sem on-select nessas telas.
- Vale para os 4 processos (Vestibular, Transferência, Portador, ENEM). Rotas: INSC_CURSO e INSC_CURSO_ENEM → INSC_TURNO → INSC_QUASE_LA.
- Colar flows/etapa1-vestibular.json na Meta depois do deploy (o servidor antigo não conhece INSC_TURNO).

# Versão 2.16.10 — documentos de inscrição esperam o portal; JSON sem `visible` inválido (19/11/2026)

- **Documentos de inscrição (Transferência, Portador, ENEM):** quando o portal ainda não mostra a etapa "Documentos inscrição", o worker não desiste mais em 6 tentativas (~16 min). Ele tenta de novo a cada 10 min por até ~24 h e entrega assim que a etapa aparece. Na 6ª espera deixa um alerta único (`etapa1_fila_atencao`, motivo `docs_nao_liberado`). Caso real: Fabiana (Transferência, 14375830) enviou 2 documentos às 15:31 e o registro foi para "falhou" às 15:48 sem entregar.
- **Diagnóstico:** com a etapa ausente, o log `docs_portal_etapas` registra só os títulos das etapas devolvidas, a inscrição e o processo.
- **Flow JSON (etapa 1):** a legenda "Escolha o curso e toque em Avançar…" saiu do `visible` (a Meta recusa comparação ali) e foi para o `else` do `If` em INSC_CURSO e INSC_CURSO_ENEM. Colar `flows/etapa1-vestibular.json` na Meta.
- Registro que já está em "falhou": o candidato reenvia pelo LOGIN → Documentos inscrição → Verificar.

# Versão 2.16.9 — curso e turno funcionam no WhatsApp Web (19/11/2026) — COLAR O JSON NOVO NA META

- No WhatsApp Web, escolher o curso (lista com ação ao selecionar) voltava o Flow para a 1ª tela sem chamar o
  servidor; no app funcionava. As listas de curso (INSC_CURSO: Vestibular, Transferência, Portador;
  INSC_CURSO_ENEM: ENEM) não têm mais ação: o 1º Avançar traz os turnos logo abaixo (turno único já marcado) e o
  2º segue. Legenda: "Escolha o curso e toque em Avançar: os turnos aparecem logo abaixo."
- O servidor continua aceitando `buscar_turnos` (quem estiver com o Flow antigo aberto não quebra).
- Outras limitações só do Web (não do nosso Flow): calendário não rola para anos antigos pela automação; título
  e rótulo do rodapé às vezes repetem os da tela anterior.

# Versão 2.16.8 — turnos do ENEM, Transferência e Portador (19/11/2026)

- Homologação ENEM (Fernanda Beatriz Teste, pelo app): presa na tela de curso e notas ("Estamos carregando os
  turnos…"). O cache de turnos era lido sempre na tela de curso do Vestibular (CURSO_INTERESSE); no ENEM
  (CURSO_ENEM) e na Transferência/Portador (CURSO_INGRESSO) o estado não abria e nenhum turno vinha
  (`etapa1_cache com_turno 0`). Agora a consulta usa a tela do próprio processo.
- Leitura sem nenhum turno não grava o cache e gera alerta `etapa1_cache_atencao sem_turnos`.

# Versão 2.16.7 — prevenção nos 4 processos (18/11/2026)

Revisão das correções da homologação do Vestibular nos outros processos (Transferência, Portador, ENEM):
- Documentos de **inscrição** (só Transf./Portador/ENEM): anexo que não abre (Flow em rascunho) agora é descartado,
  os bons seguem ao portal e a etapa reabre no Flow, sem loop (alerta `etapa1_fila_atencao docs_refazer`).
- Pix recusado pelo portal (ex.: taxa sem valor no TOTVS, caso da Rosa/Helena): não repete, alerta a equipe na
  hora (`etapa_aviso_atencao pix_recusado`) e a tela de pagamento orienta "Tentar novamente" ou o Portal.
- Vigia do pagamento no ritmo dos outros: 10 min nas 2 primeiras horas depois do contrato, depois de hora em hora.
- Já valiam para os 4 (código comum): lista de status com "end" em todos (2.16.1), documentos de matrícula
  inválidos (2.16.2), contrato só com documentos aprovados (2.16.3), status guardado pelos vigias (2.16.4),
  cobrança no formato do Blip validado (2.16.5–2.16.6), passo de pagamento por processo.

# Versão 2.16.6 — cobrança no formato validado no Blip (18/11/2026)

- A cobrança segue o corpo testado no Postman que chegou com os botões de pagamento: template
  `unibalsas_cobranca_matriculav1`, `payment_link.uri` (formato da Meta; com `link` o botão não é montado),
  chave CNPJ, `order.tax = 0`, `campaign.channelType = WhatsApp`, sem `audience.name`.

# Versão 2.16.5 — botão de pagamento aceito pelo WhatsApp (18/11/2026)

- 1º disparo real da cobrança (Nair, 14:16): o Blip aceitou, mas a Meta recusou com #131008 "'action' cannot be
  null for PAYMENT_REQUEST button type" (botão de pagamento vazio). Causas prováveis no #payment#: key_type "EVP"
  (o Blip só aceita CNPJ, CPF, EMAIL, PHONE) e order.tax ausente (o exemplo do Blip sempre manda).
- Agora: chave da cobrança se for de tipo aceito; se for aleatória, a do recebedor em PIX_CHAVE (CNPJ
  07344774000189); `order.tax = 0`. O pagamento continua pelo código Pix dinâmico do TOTVS.
- Cloud Run: PIX_CHAVE=07344774000189.

# Versão 2.16.4 — LOGIN já abre com o que foi avisado (18/11/2026)

- Homologação (Nair): depois do aviso "documentos aprovados", o 1º LOGIN ainda mostrava a etapa pendente (status
  guardado das 13:34; o portal é lento e o LOGIN abre com o guardado). O vigia do contrato agora guarda o status
  que leu, como os vigias da redação, da inscrição e do pagamento já faziam.

# Versão 2.16.3 — contrato só depois da aprovação dos documentos (18/11/2026)

- Homologação do zero (Nair): o vigia do contrato gerou o contrato e avisou "documentos aprovados" 10 min depois
  do envio, com os documentos ainda em análise. Causa: o passo do contrato existe no portal antes da aprovação
  (o bloqueio do site é só visual). Agora o contrato só é liberado com "Documentos matrícula" concluído
  ("Entregues"); antes disso o vigia segue aguardando (`contrato_aguardando`).
- Auto-correção: quem recebeu o aviso cedo tem o aviso e o contrato desfeitos no próximo login/atualização
  (`contrato_cedo_desfeito`) e volta a ser avisado quando a equipe aprovar.
- Worker: retorno 204 ao reabrir documentos inválidos (antes, status HTTP indefinido).

# Versão 2.16.2 — documento que não abre é pedido de novo (18/11/2026)

- Homologação do zero: anexos enviados pelo Flow em rascunho (prévia da WABA) chegam como mídia de mentira
  (cdn_url sem link, chaves de 2 bytes). O worker repetia "Arquivo inválido" sem fim e o Flow dizia "enviados".
- Agora o worker envia os anexos bons, descarta os que não abrem (log `documento_invalido`), reabre as telas de
  documento no Flow (com aviso de quais reenviar) e não conta como erro do sistema. JSON do Flow sem mudança.
- Teste com anexos: sempre pelo Flow PUBLICADO, aberto no app do WhatsApp (não pela prévia do editor).

# Versão 2.16.1 — lista de etapas aceita pelo WhatsApp (18/11/2026)

- Correção (homologação do zero): a Meta recusava a lista de status no LOGIN ("NavigationList cannot have only
  some items with end") e o WhatsApp mostrava "ocorreu um erro". Agora todos os itens têm o botão à direita:
  a etapa aberta mostra a ação do site, a concluída "OK" e as demais "Aguarde". JSON do Flow sem mudança.
- Aviso de "redação liberada" (etapa 1) passa a usar o template unibalsas_atualizacao_processo, com a trava
  AVISOS_SO_PARA (antes usava um template antigo de 2 parâmetros e não respeitava a trava).

# Versão 2.16.0 — pagamento pelo Blip (18/11/2026)

- Tela nova **MATR_PAGAMENTO** no Flow (cole o JSON novo na Meta): valor da taxa + "Realizar pagamento". O
  pagamento é feito fora do Flow, pela mensagem do Blip com Pix (copia e cola) e link do cartão.
- A cobrança sai só a pedido do candidato (antes saía sozinha quando o contrato era assinado). O vigia avisa
  "pagamento liberado", guarda o valor e, depois do envio, confere o "Recebido" a cada 2 min por 70 min.
- Dados do sistema: Pix gerado no TOTVS, valor do 38658, recebedor e chave Pix lidos da cobrança do próprio Pix
  (Banco Rendimento; chave aleatória/EVP). Pix vale 1 h (o Run guarda 50 min).
- `payment_link.link` (formato do Blip); `AVISOS_SO_PARA` para testar só com números liberados.
- Pix e matrícula: "Recebido" = 38657 = 1 (< 1 min após o pagamento); Matriculado pendente = 38669 = "F" (liberação manual).

# Versão 2.15.1 — relatório de uso (log `flow_tela`)

- Uma linha de log por toque no Flow: sessão anônima (8 caracteres do hash do flow_token), tela de origem, ação, tela de destino e tempo de resposta. Sem CPF, nome ou celular. Comandos de leitura no README.
- README atualizado com a etapa 2 dos 4 processos. Versão esperada no `GET /api/flow`: `unibalsas-cloudrun-jornada-2.15.1`.

# Versão 2.15.0 — etapa final dos 4 processos (pagamento sem botão, "Recebido" → equipe, recusa do RM, login rápido)

- **Pagamento por processo** (`passoPagamento` em `api/processes.js`): Vestibular 300670, Transferência 300701, Portador 300686, ENEM 300716 (provisório). Na Transferência e no Portador o portal mostra "Pagamento" sem botão; o Run usa o passo do processo para a cobrança e a lista mostra "Pendente [Pagar]".
- **"Recebido" → equipe:** Pagamento recebido com Matriculado pendente mostra "Aguardando confirmação da equipe" e manda o aviso `pagamento_recebido` uma vez. A liberação do Matriculado continua manual; o aviso final diz "confirmada pela equipe".
- **Recusa do RM** ("Não foi possível fazer a matrícula!"): a fila vai para `conferir` (`rm_recusou`, alerta `etapa2_fila_atencao`), a Pré-matrícula mostra "Em conferência pela equipe" e o próximo login/atualização depois de 30 min retoma.
- **Login rápido:** com status guardado, espera o portal só 2 s (`ETAPA2_ESPERA_CACHE_MS`) e relê em 2º plano. Flow (JSON) sem mudança.
- 174 testes. Versão esperada no `GET /api/flow`: `unibalsas-cloudrun-jornada-2.15.0`.

# Versão 2.14.0 — status depois do Enviar, "Atualizar" resolvido pelo Run e código só da versão atual

**O Flow da WABA muda:** colar o novo `flows/etapa1-vestibular.json` no editor da Meta e publicar.

- **Documentos de inscrição (Transferência, Portador, ENEM):** o "Enviar" do último documento volta ao status do portal, como no site: Inscrição Concluída · [ENEM] Checando as notas Validando · **Documentos inscrição Em análise**. É a tela final (`INSC_DOCS_FIM`, terminal): o envio já está agendado no Run, então "Concluir" ou fechar o Flow finaliza.
- **Reenvio pelo LOGIN:** documento recusado aparece como "Recusado na análise: envie de novo." e é obrigatório (antes podia aparecer como opcional).
- **"Atualizar" (mapa abaixo):** o toque agora espera, dentro do prazo da Meta (até 7,5 s, `ETAPA2_ESPERA_STATUS_MS`), o status que o Run já está lendo em segundo plano; um toque basta. Status salvo vencido (mais de 6 h) também agenda a releitura.
- **Limpeza (só a 2.13+ vale):** saíram o Flow antigo (`flow-waba.json`), o motor de jobs com "Verificar andamento" (`api/jobs.js`), o endpoint `/api/flow/etapa1` e o caminho antigo `ETAPA1_FILA` (telas `ESCOLHA_PROCESSO`, `DADOS_BASICOS`... vindas do Flow). Entrada única em `/api/flow`: ping, INIT (link da redação ou tela inicial), `MATR_*`/`CONTR_*` e `INSC_*`; tela de Flow antigo recebe um fim com orientação; tarefa antiga sem tipo é descartada. As telas internas do motor continuam só para o worker gravar no Rubeus. A imagem do Cloud Run deixa de levar testes, documentação e o JSON do Flow.
- 173 testes (os que só testavam o Flow antigo saíram; novos: entrada única criptografada, status final, reenvio obrigatório, "Atualizar" em um toque). Versão esperada no `GET /api/flow`: `unibalsas-cloudrun-jornada-2.14.0`.

### Mapa do "Atualizar" (onde ainda pode aparecer)

| Momento | Por quê | O que o Run faz |
|---|---|---|
| 1º LOGIN de quem ainda não tem status salvo, com o portal passando de 6,5 s | O portal do Rubeus leva de 7 a 16 s; a Meta dá 10 s | Agenda `etapa2_status` (lê e salva o status); o toque em "Atualizar" espera esse resultado (até 7,5 s) e abre a lista |
| LOGIN com status salvo há mais de 6 h e portal lento | Status velho não é mostrado | Igual ao de cima |
| Toque numa etapa da lista sem status salvo válido | Mesmo motivo | Agenda a releitura e o "Atualizar" espera |

Quem se inscreveu pelo Flow já tem o status salvo (V1: depois dos documentos de inscrição e da redação), então não vê o "Atualizar". As telas "Verificar andamento" e "Atualizar situação" eram do Flow antigo e saíram do caminho do candidato.

# Versão 2.13.0 — Transferência, Portador e Nota do ENEM igual ao site (etapa 1 com documentos de inscrição)

Projeto e mapeamento: `ENGENHARIA-FLOW-INSCRICAO-DIRETA.md` (e as engenharias reversas de cada processo). **O Flow da WABA muda:** colar o novo `flows/etapa1-vestibular.json` no editor da Meta.

- **Etapa 1 dos 3 processos:** Concluir → "Obrigado pelo seu cadastro!" → Portal (`INSC_STATUS`: Inscrição Concluída · [ENEM] Checando as notas Validando · Documentos inscrição Pendentes) → **Verificar** → documentos de inscrição, um por tela (`INSC_DOC_A/B/C`; o 1º é o obrigatório) → `INSC_DOCS_FIM`. Listas em `api/processes.js` (Transferência 28\*/29/27, Portador 10\*/17/26, ENEM 25\*).
- **Worker (etapa 1):** depois da inscrição, passo `docs_inscricao`: calma de 60 s (`ETAPA1_ESPERA_DOCS_MS`), entra no portal, acha "Documentos inscrição" pelo link, um único "Enviar" multipart (mesmo caminho dos documentos de matrícula), confere no passo; não reenvia o que já está em análise/aceito. Depois apaga os dados pessoais e as referências dos arquivos.
- **Vigia da inscrição (`inscricao_vigia`, etapa 2):** 10 min nas 2 primeiras horas, depois de hora em hora, até 15 dias. Recusa → aviso e o LOGIN pede só os recusados; aprovado (etapa seguinte liberada, ou ENEM 38623 de 4 a 8 com documentos aprovados) → aviso e para; ENEM 38623 = 3 → aviso "desclassificado" (texto do site) e para. Template `unibalsas_atualizacao_processo` (sem template novo).
- **Nota do ENEM:** notas na tela do curso (`INSC_CURSO_ENEM`), como no site; a média é calculada no Run e aparece na "Estamos quase lá" (V3: os campos do ENEM saíram dessa tela).
- **LOGIN:** "Documentos inscrição: Pendentes [Verificar]" abre as telas de documento; a lista de status ganhou ícones (concluída, pendente, em análise, recusada). "Documentos inscrição" nunca é confundida com "Documentos matrícula" (status, vigias e worker).
- **V1:** o status do portal fica salvo para o LOGIN (vigia da redação com 1ª conferência em 2 min; envio dos documentos de inscrição; vigia da inscrição).
- **V2 (5 MB) não entrou:** continua 740 KB, para homologar depois.
- 211 testes. Versão esperada no `GET /api/flow`: `unibalsas-cloudrun-jornada-2.13.0`.

# Versões anteriores

Fora de uso desde a 2.13.0 (Flow único `flows/etapa1-vestibular.json`). O histórico completo fica no git (`git log`).
