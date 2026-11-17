# Revisão (check) da versão 2.12.0 — 17/11/2026

Revisado: `REVISAO-ARQUITETURA-2027.md`, `MAPA-JORNADA-2027.md`, o código publicado (commit 9c4266c, `GET /api/flow` = `unibalsas-cloudrun-jornada-2.12.0`) e o Flow da WABA (`flows/etapa1-vestibular.json`).

Conferido por execução: 194 testes passam; `node flows/gerar-etapa1.mjs` reproduz o JSON sem diferença; as 28 telas têm rotas, dados declarados e nomes de campo coerentes.

Não conferido: nenhum envio real pelo Blip; variáveis do Cloud Run; se o Flow colado na WABA é este arquivo.

## 1. Check por etapa

| Etapa | Situação | Observação |
|---|---|---|
| Flow: estrutura (JSON 7.3, 28 telas, ~230 KB) | Check | Rotas só para frente; telas finais corretas; logos leves |
| Flow: inscrição (`INSC_*`) | Check | Igual ao site (processo → dados → curso → quase lá → portal → prova) |
| Flow: login e status (`MATR_LOGIN`, `MATR_STATUS`) | Check, com ajuste | Ver C4 (mensagem e folga de tempo) |
| Flow: matrícula e documentos (`MATR_*`) | Check | Um documento por tela, 3 obrigatórios, como no site |
| Flow: contrato (`CONTR_TERMOS`) | Check | Texto do site + link exclusivo do PDF |
| Run: recebe, valida, grava e responde na hora | Check | Nenhuma tela espera o Rubeus gravar |
| Run: worker da matrícula (ordem do portal, novas tentativas) | Check | Reabre no login quando falhou |
| Run: vigia da redação | Check | Só avisa "não aprovada" depois de ver "Aguardando correção" |
| Run: vigia do contrato | **Corrigir** | C1, C2, C3 |
| Run: vigia final e cobrança Pix | **Corrigir** | C1, C2, C3, C5 |
| Avisos pelo Blip | Check no código, **sem teste real** | Payload confere com a documentação; C6 e C7 em aberto |
| Segurança e LGPD | Check | Fila criptografada, estado selado, worker assinado, celular e CPF fora dos logs |
| Documentação | **Atualizar** | C8 |

## 2. Instruções de correção (para a IA)

Regras fixas: não mudar a etapa 1; endpoint continua `/api/flow`; não enviar pelo Blip em teste sem o usuário pedir; publicar só com o "publicar" do usuário; cada correção com teste em `test/etapa2-matricula.test.js`.

### C1 (alta) — FEITO na 2.12.1 — Correntes de vigia duplicadas
**Problema.** `enqueueJob` cria nome único por disparo (`api/cloud-store.js`), então nada impede duas correntes do mesmo vigia. Em `api/etapa2-matricula.js`:
- `abrirDestino` (linha 322) dispara `etapa3_gerar` toda vez que o candidato abre o contrato sem PDF pronto (PDF vencido após 7 dias ou maior que 600 KB, que nunca é guardado);
- `vigiarContrato` com `imediato` cai na linha 481 e agenda um `etapa3_vigia` novo a cada falha, e nas linhas 461 e 468 agenda `etapa4_vigia` sem olhar `final_vigiando`.

Cada corrente extra repete a conferência de hora em hora por até 30 dias, faz login em paralelo (um login derruba o outro no portal) e pode mandar a cobrança duas vezes, porque `vigiarFinal` decide com o `rec` lido no início.

**Fazer.**
1. Criar `agendarVigia(id, tipo, atrasoSeg)`: grava na fila `vigia_proxima: { [tipo]: clock() + atrasoSeg*1000 }` e chama `enqueue`. Usar em todos os `enqueue` de `etapa3_vigia`, `etapa4_vigia` e `redacao_vigia`.
2. No início de `vigiarContrato` (quando não é `imediato`), `vigiarFinal` e `vigiarRedacao`: se `clock() < vigia_proxima[tipo] - 30000`, devolver 204 sem agendar nada (é tarefa de corrente antiga).
3. `vigiarContrato` com `imediato`: nunca agendar `etapa3_vigia`; só agendar `etapa4_vigia` se `!rec.final_vigiando`.
4. Trava de execução: `vigia_rodando_ate = clock() + 170000` no início (com `store.update` condicional; se perder, devolver 204) e zerar no fim. Em `enviarCobranca`, reler a fila logo antes de `avisos.cobranca` e sair se `cobranca_enviada_em` já existir.
5. Testes: abrir o contrato 3 vezes sem PDF gera uma única corrente final; duas execuções simultâneas de `vigiarFinal` enviam uma cobrança.

### C2 (alta) — FEITO na 2.12.1 — Corrente de vigia morre em silêncio
**Problema.**
- Todo reagendamento é `try { await enqueue(...) } catch {}`. Se o Cloud Tasks falhar uma vez (o `googleRequest` tem limite de 2 s), a corrente acaba e ninguém fica sabendo; o candidato nunca recebe aviso nem cobrança.
- A fila da matrícula nasce com `expires: clock() + 30 * DIA` (linha 719) e esse prazo nunca é renovado. O contrato pode levar 15 dias e a etapa final mais 30: o documento pode ser apagado pelo Firestore no meio do vigia (`if (!f) return 204`).

**Fazer.**
1. Em `agendarVigia`, se o `enqueue` falhar: tentar mais uma vez e, se falhar de novo, lançar erro. Em `workerHandler` (`api/flow.js` linhas 1545–1558), devolver **500** quando o vigia lançar erro de agendamento, para o Cloud Tasks repetir a tarefa (com C1 a repetição é segura). Registrar `console.error` com `event: 'vigia_atencao'`.
2. Ao iniciar ou reagendar um vigia, gravar `expires = max(expires atual, fim do vigia + 7 dias)`.
3. Teste: `enqueue` que falha na 1ª chamada não encerra a corrente.

### C3 (alta) — FEITO na 2.12.1 — Vigia só começa para quem entregou os documentos pelo Flow
**Problema.** O único início do vigia do contrato é a linha 962 (depois de `entregarDocumentos`). Quem enviou documentos pelo site, quem já está com o contrato liberado ou com o pagamento pendente e apenas entra pelo Flow não ganha vigia: não recebe "documentos aprovados", cobrança nem "matrícula concluída". A arquitetura (seções 2.5 e 4.2) descreve os avisos como se valessem para todos.

**Fazer.** No login (`routeTela`, depois de `salvarStatus`) e em `atualizarStatus`, com o status do portal em mãos:
- etapa de documentos de matrícula não conclusiva e sem botão (em análise), ou contrato não conclusivo → se `!rec.vigia_ate`, `agendarVigia(id, 'etapa3_vigia', 600)`;
- contrato conclusivo e pagamento não conclusivo → se `!rec.final_vigiando`, gravar `final_vigiando` e `agendarVigia(id, 'etapa4_vigia', 60)`.
Não pode atrasar a resposta do login: agendar sem `await` longo (uma chamada, erro ignorado, porque o próximo login tenta de novo). Isso também religa correntes perdidas (reserva do C2). Teste para cada caso.

### C4 (média) — FEITO na 2.12.2 — Login: mensagem errada e pouca folga de tempo
**Problema.**
- Linha 703: qualquer erro do `matricula.login` (inclusive Rubeus fora do ar ou lento) vira "Não encontramos uma inscrição com esses dados". A própria arquitetura (seção 2.7) lista isso como melhoria pendente.
- O login espera o portal até 7,5 s e **depois** faz de 5 a 7 chamadas seguidas ao Firestore/Cloud Tasks (`get`, `create|update`, `get`, `salvarStatus` = `get`+`update`, `enqueue`), cada uma com limite de 2 s. Com o Run acordando, passa dos 10 s do WhatsApp.

**Fazer.**
1. Em `matricula.login`, diferenciar "credenciais recusadas" de erro de rede, tempo esgotado ou HTTP 5xx; no segundo caso mostrar: "O sistema da UniBalsas está indisponível no momento. Tente de novo em alguns minutos."
2. Baixar o padrão de `esperaPortalMs` para 6500 e gravar a fila e o `ultimo_status` em **uma** escrita (montar o registro completo e fazer um `create` ou um `update`; não reler depois).
3. Registrar no log `etapa2_fila` do login o tempo total (`ms`) para acompanhar.

### C5 (média) — FEITO na 2.12.2 — Aviso ou cobrança que esgota as tentativas não alerta ninguém
**Problema.** Depois de 5 falhas (`MAX_TENTATIVAS_AVISO`), `enviarCobranca`, `avisar` e `vigiarRedacao` param com um log comum.
**Fazer.** Na 5ª falha, `console.error(JSON.stringify({ event: 'etapa_aviso_atencao', id: curto(id), aviso, motivo }))` (sem celular e sem CPF). Incluir o evento na seção 4.5 da arquitetura.

### C9 (média) — FEITO na 2.12.2 — Dados gravados no Run que ficam sem worker
**Problema.** Em `api/etapa2-matricula.js`:
- `gravarBloco` (linha 170) e `gravarDocumento` (linha 233) só registram no log quando o `enqueue` falha. Os dados ficam no Firestore com `status: 'pendente'`, mas nenhum worker roda; o login só reagenda quando o status é `falhou` (linha 724).
- `worker` (linha 892): se a trava `rodando_ate` está ativa, a tarefa nova devolve 204 e some. Um bloco que chega no instante em que o worker anterior está saindo (`aguardando_<bloco>`) fica parado até o candidato enviar a tela seguinte.

**Fazer.**
1. No `worker`, quando a trava estiver ativa: `enqueue(id, { tipo: 'etapa2', atrasoSeg: 30 })` antes de devolver 204 (a trava vence em 170 s, então não há repetição sem fim).
2. No login, além de `falhou`: se `status === 'pendente'`, `rodando_ate` vencido e existe bloco em `blocos` sem o par em `enviados` (ou `blocos.documentos.completo` sem `status: 'concluida'`), agendar `etapa2`.
3. Em `gravarBloco`/`gravarDocumento`, tentar o `enqueue` duas vezes antes de desistir.
4. Testes: tarefa que encontra a trava reagenda; login com bloco parado reagenda.

### C10 (baixa) — FEITO na 2.12.3 — Toque em "Pagamento" na lista de status
Hoje mostra só a orientação do site (`portalScreenData`, linha 778). Com a cobrança pelo WhatsApp: se `cobranca_enviada_em` existe, trocar a mensagem para "Enviamos o Pix da taxa de matrícula por mensagem aqui no WhatsApp. Para pagar com cartão, acesse o Portal do candidato."; se não existe e a cobrança está configurada, agendar `etapa4_vigia` em 5 s (via `agendarVigia` do C1) e mostrar "Você vai receber o Pix por mensagem em instantes." Não gerar o Pix dentro da tela (leva ~20 s).

### C6 (decisão do usuário) — MANTIDO como está (17/11) — Cobrança sai uma vez só
A cobrança é enviada uma vez (`cobranca_enviada_em`). A validade do Pix do TOTVS não foi medida; se o candidato tentar pagar depois que o código vencer, só resta o link do portal. Perguntar ao usuário antes de implementar: reenviar a cobrança com Pix novo depois de N horas com o pagamento ainda pendente (no máximo 2 vezes)? Para medir a validade: gerar um Pix de teste e conferir no portal quando o campo 50901 muda.

### C7 (decisão do usuário) — MANTIDO como está (17/11) — Botão do aviso abre a tela de inscrição
O botão "Acessar minha inscrição" do template `unibalsas_atualizacao_processo` abre em `INSC_INICIO`; quem recebe "documentos aprovados" precisa achar o link "Já sou inscrito (LOGIN)". Mais fluido: o botão abrir direto em `MATR_LOGIN` (dados iniciais `erro: ""`, `tem_erro: false`, `valor_login: ""`, `valor_data_nascimento: ""`). Isso exige editar o template na Meta (nova aprovação): só fazer se o usuário pedir.

### C8 (baixa) — Documentação e limpeza
1. `MAPA-JORNADA-2027.md` está na situação de 12/11: marca como pendente o que já foi feito (CEP 38568, RG como digitado, ano de conclusão opcional 1995+, contrato com PDF, pagamento). Atualizar a tabela da seção 2 e esvaziar a seção 3, conferindo cada item no código antes de marcar.
2. `README.md` diz versão 1.6.16 e Flow `flow-waba.json`; `package.json` diz 2.6.0. Atualizar para 2.12.x e apontar para `REVISAO-ARQUITETURA-2027.md` e `flows/etapa1-vestibular.json`.
3. `CHECKLIST-TESTES-1.6.6.md` e `RESUMO-TECNICO.md` são de versões antigas: marcar no topo "histórico" ou remover.
4. Há dois Flows no repositório: `flow-waba.json` (antigo, telas `ESCOLHA_PROCESSO`…) e `flows/etapa1-vestibular.json` (atual). Perguntar ao usuário se o antigo ainda está publicado em alguma WABA. Se não, planejar a retirada do código que só serve a ele (`api/jobs.js` e as telas antigas em `api/flow.js`); não remover sem o OK.
5. `flows/gerar-etapa2.mjs`: tirar `valor_data_nascimento` do `data` de `MATR_LOGIN` e de `MATR_RESP_DADOS` (declarado e não usado) e da lista `KEYS` correspondente em `api/etapa2-matricula.js`; gerar de novo e conferir no editor da Meta.
6. `REVISAO-ARQUITETURA-2027.md`: acrescentar em "Pontos em aberto" que a fila é criptografada com chave derivada da `FLOW_PRIVATE_KEY` (`api/cloud-store.js`); trocar a chave do Flow torna ilegíveis as filas em andamento.
7. `api/blip.js`: `avisarRedacaoLiberada` repete o envio de `campanha`; quando o aviso de "prova liberada" for ligado, passar a usar `createAvisosBlip().atualizacao`.

## 3. Ordem sugerida

C1 → C2 → C3 (uma versão, 2.12.1, antes de ligar as variáveis do Blip) → C9, C4 e C5 → C10 → C8.

## 4. Alcance desta revisão do Run

Lido linha a linha: `api/etapa2-matricula.js` (login, status, telas da matrícula, contrato, vigias, avisos, cobrança, worker), `api/blip.js`, `api/portal-site.js` (acesso ao portal), `api/cloud-store.js`, `api/jobs.js`, `server.js` e a entrada/saída de `api/flow.js` (assinatura, criptografia, worker).

Não relido linha a linha (cobertos só pelos 194 testes): `api/etapa1-fila.js` (etapa 1, que não deve ser alterada), `api/matricula.js` e as telas do Flow antigo dentro de `api/flow.js`. C6 e C7 dependem de resposta do usuário.
