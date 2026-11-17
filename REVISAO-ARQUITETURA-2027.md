# Revisão da arquitetura — Flow UniBalsas 2027/1 (versão 2.12.0, 16/11/2026)

Documento para quem continuar o projeto (pessoa ou IA). Explica como o sistema funciona, o que é feito ao vivo e o que é feito em segundo plano, onde há redundância e onde ainda há risco.

## 1. Peças

| Peça | Papel |
|---|---|
| **WhatsApp Flow** (JSON único `flows/etapa1-vestibular.json`, colado na WABA) | Só telas. Listas fixas (UF, cor/raça, estado civil, documentos) vêm prontas no JSON; listas que mudam (cursos/turnos, escolas) vêm do cache do Run. Cada tela manda os dados ao Run (`data_exchange`). |
| **Google Cloud Run** (`/api/flow`, mínimo de 0 instâncias) | Recebe cada tela, valida, **grava no Firestore e responde na hora**. Desliga sozinho quando ninguém usa (escala para zero); acorda com a próxima requisição. |
| **Firestore** (`inscricoesFila`, `matriculaFila`, `redacaoVigia`, `flowCache`, `contratoLinks`, `contratos`…) | Fila durável. Tudo o que o candidato preencheu fica guardado (criptografado) até chegar ao Rubeus. |
| **Cloud Tasks** (fila `unibalsas-flow`) | Agenda o **worker** do Run (`/internal/flow-worker`, assinado por HMAC) — envio ao Rubeus, novas tentativas, vigias. Acorda o Run mesmo com zero instâncias. |
| **Blip** (API Active Campaign, `POST {BLIP_API_URL}/commands`, `uri /campaign/full`) | Envia as mensagens ativas do WhatsApp disparadas pelo Run: avisos de etapa e cobrança com Pix (templates aprovados na Meta). O Run só chama o Blip; o Blip não chama o Run. |
| **Rubeus** (API oficial `admin.portal.apprbs.com.br` + API do site `vestibular.unibalsas.edu.br/api/applyment/*`) | Sistema de inscrição/matrícula da UniBalsas (e TOTVS por trás). O Run conversa com ele igual ao navegador (engenharia reversa em `ENGENHARIA-REVERSA-VESTIBULAR-2027.md`). |

## 2. Respostas às perguntas da revisão

### 1. "A maior parte ou tudo é feito no Cloud Run?"
**Sim.** Toda gravação no Rubeus é feita pelo worker do Run, em segundo plano: inscrição (dados básicos, curso, turno, final), redação, responsável, endereço, identidade, documentos (pelo passo do site), geração do contrato. O Flow nunca espera o Rubeus gravar.

### 2. "A única consulta instantânea ao Rubeus é o status?"
**Quase.** Ao vivo (dentro do tempo da tela do WhatsApp, ~10 s) existem só estas consultas:

| Consulta ao vivo | Por quê | Limite de tempo |
|---|---|---|
| **Login** (CPF + data de nascimento) | conferir quem é a pessoa — não dá para adiar | ~1–3 s |
| **Status do portal** no login | saber em que etapa a pessoa está | espera até 7,5 s **contando o login**; se o portal demorar (comum: ~12–16 s), usa o último status salvo ou mostra "Atualizar" e busca em segundo plano |
| **CEP** (botão "Buscar endereço") | preencher o endereço | ~1–2 s (opcional; dá para digitar) |
| **Escola** (botão "Buscar escola") | lista de ~1.461 escolas | usa o cache; sem cache tenta no máximo 5 s e libera a tela |

Fora do Flow (no navegador, não sujeito aos 10 s): o link do contrato. Normalmente o PDF já está pronto (gerado pelo vigia); se não estiver, o Run gera na hora (~20 s) e a página espera e se atualiza sozinha.

### 3. "O Flow tem o JSON na WABA com quase todos os dados prontos e envia as informações ao Run?"
**Sim.** O JSON tem as telas, textos e listas fixas. Os dados variáveis (status, cursos, escolas, link do contrato) chegam pela resposta do Run. Cada tela devolve um `estado` selado (AES-GCM) que impede o candidato de alterar identidade/etapa.

### 4. "O Run confere, guarda e envia ao Rubeus; se falhar, tenta de novo; a próxima etapa só abre quando a anterior concluiu?"
**Sim.**
- **Confere:** cada tela é validada no Run (CPF, datas, CEP, campos obrigatórios, ano, lista de escolas). Erro → a mesma tela volta com a mensagem; nada vai ao Rubeus.
- **Guarda e envia:** grava no Firestore e agenda o worker. O worker envia **um passo por vez, na ordem que o portal libera** (ele pergunta ao portal qual é o próximo passo; passos já concluídos não são reenviados).
- **Tenta de novo:** falhou → nova tentativa com espera crescente (1, 2, 4, 8, 10 min…), até 6 vezes; depois fica `falhou` e é **reaberta automaticamente quando o candidato entra de novo** (etapa 2). Erros "definitivos" (ex.: opção que não existe no formulário) ficam `conferir` para a equipe olhar.
- **Ordem:** o Flow só mostra o botão das etapas abertas no portal; documentos esperam a identidade gravada (+2 min para o RM gerar o RA); contrato só depois da aprovação dos documentos; pagamento só depois do contrato assinado.

### 5. "O Rubeus se comunica com o Run, que depois se comunica com o Flow?"
**Não diretamente — o Rubeus não avisa ninguém** (não há webhook configurado). Quem pergunta é o Run:
- no **login** (status ao vivo ou salvo);
- pelos **vigias** (Cloud Tasks), que conferem o portal e, quando algo muda, guardam o novo status e **mandam o aviso pelo WhatsApp** (seção 4):
  - **redação** (começa quando a etapa 1 confirma a entrega): 10 min nas 2 primeiras horas, depois de hora em hora, até 15 dias;
  - **contrato** (começa depois dos documentos entregues): mesmo ritmo, até 15 dias;
  - **etapa final** (pagamento → matriculado): de hora em hora (10 min enquanto uma cobrança está para ser reenviada), até 30 dias.
- O Rubeus tem webhooks (Configurações → Integrações → Webhooks), mas sem lista pública de gatilhos; se a UniBalsas cadastrar um gatilho de mudança de status apontando para o Run, os vigias viram só reserva.

### 6. "O Run não fica 100% ativo?"
**Correto.** Mínimo de instâncias = 0: sem tráfego, desliga. O Cloud Tasks acorda o Run para cada tarefa. Custo: cada conferência de vigia leva ~15 s (o portal é lento); por isso os vigias espaçam as conferências (10 min → 1 h).

### 7. "Se o Rubeus cair por alguns minutos, o candidato se perde? Há redundância?"
**Não se perde o que já foi enviado ao Run.**
- **Inscrição (etapa 1):** a 1ª tela (dados de contato) e as seguintes são gravadas no Firestore **antes** de qualquer chamada ao Rubeus; o worker tenta de novo por ~30 min (6 tentativas). O candidato continua preenchendo normalmente.
- **Matrícula (etapa 2):** idem; e se as tentativas acabarem, o próximo login reabre a fila.
- **Limites (o que ainda depende do Rubeus no ato):**
  1. o **login** precisa do Rubeus: com o Rubeus fora, a pessoa não entra (hoje a mensagem é "Não encontramos uma inscrição…" — melhoria: dizer "sistema indisponível, tente em alguns minutos");
  2. se o Rubeus ficar fora **mais de ~30 min**, a fila da inscrição (etapa 1) fica `falhou` e precisa ser reprocessada (melhoria: janela de tentativas maior, por exemplo até 24 h com espera crescente);
  3. o Firestore e o Cloud Tasks são serviços gerenciados do Google (redundantes por natureza); os dados ficam criptografados com prazo de expiração.

### 8. "Alguma etapa em que o Flow ainda espera o Rubeus mais de 10 s?"
**Não.** O maior caso é o login (login + status com teto de 7,5 s somados). Tudo o que demora — gravar passos (até 15 s por passo), gerar o contrato no TOTVS (~14,5 s), gerar o Pix (~5 s), ler as etapas do portal (~12–16 s), enviar mensagens pelo Blip — roda no worker/vigias ou no navegador. Atenção só ao **primeiro acesso depois de parado** (Cloud Run acordando, +1–3 s) somado a um login lento.

### 9. "Ao logar, a primeira tela é sempre o Status, com o botão da próxima etapa disponível?"
**Sim (versão 2.10.0+).** Login → tela de status igual ao Portal do candidato (lista: ✅ concluída / ❗ pendente, com o status do site e o botão "Verificar" nas etapas abertas). Tocar numa etapa aberta leva à sua tela. Exceções intencionais:
- **Prova liberada** → vai ao "Portal do candidato" da etapa 1 ("Realizar prova"), que é a própria tela de status da etapa 1 (a etapa 1 não foi alterada);
- **Portal lento e sem status salvo** → tela "Estamos buscando a situação da sua inscrição…" com **Atualizar**.

## 3. Etapas, quem libera e o que o Run faz

| Etapa (portal) | Quem libera | No Flow | No Run (segundo plano) |
|---|---|---|---|
| Inscrição | candidato | telas de inscrição | grava no Rubeus |
| Prova online | candidato | redação | espera 10 min, confere a prova 2× e envia |
| — correção da redação | **equipe** | status "Aguardando correção" | vigia da redação → aviso **aprovada** ou **não aprovada** |
| Resp. financeiro / Pré-matrícula | candidato | telas da matrícula | grava passo a passo |
| Documentos matrícula | candidato | 7 telas (3 obrigatórios) | envia pelo passo do site (multipart) e confere "Em análise" |
| — análise dos documentos | **equipe** (até 48 h úteis) | status "Em análise" | vigia do contrato → gera o PDF → aviso **documentos aprovados** |
| Contrato | candidato (baixa, assina no GOV.BR e envia por e-mail) | tela do site + link exclusivo do PDF | gera e guarda o PDF ao liberar |
| — conferência do contrato assinado | **equipe** | status | vigia final |
| Pagamento | candidato (Pix ou cartão) | orientação do site (fora do Flow) | gera o Pix como o site → **cobrança pelo WhatsApp** (Pix + link do portal) |
| — confirmação do pagamento | TOTVS | status | aviso **matrícula concluída** |
| Matriculado ("Parabéns!") | — | status ✅ | fim da jornada |

## 4. Avisos pelo WhatsApp e cobrança (versão 2.12.0)

O Run manda mensagens ativas pelo Blip quando um vigia **confirma no portal** que a etapa anterior foi concluída e a próxima abriu. Nada é enviado com base em suposição.

### 4.1 Templates aprovados na Meta (16/11/2026, Utilidade, pt_BR)

| Template | ID | Variáveis | Botões |
|---|---|---|---|
| `unibalsas_atualizacao_processo` | 1817217749539469 | {{1}} primeiro nome · {{2}} processo · {{3}} o que aconteceu · {{4}} próximo passo | Flow `Acessar minha inscrição` (navigate → `INSC_INICIO`) |
| `unibalsas_cobranca_matricula` | 4602120220057390 | {{1}} primeiro nome · {{2}} valor **sem "R$"** (ex.: `390,00`) | Copiar código Pix · Abrir link de pagamento ("Pedir pagamento") |

Regras da Meta nas variáveis: sem quebra de linha, tabulação ou mais de 4 espaços seguidos; o Run limpa isso antes de enviar. Rodapé dos dois: `UniBalsas - Centro Universitário de Balsas`.

### 4.2 Quando cada mensagem sai

| Momento | Quem detecta | Condição conferida no portal | Template | {{3}} / {{4}} |
|---|---|---|---|---|
| Redação aprovada | vigia da redação | Prova online concluída **e** a etapa seguinte aberta com o botão do site | atualização | "Sua redação foi corrigida e você foi aprovado(a)! 🎉" / "informe o responsável financeiro, seus dados e envie os documentos da matrícula pelo botão abaixo." |
| Redação não aprovada | vigia da redação | a prova saiu de "Aguardando correção" sem concluir e voltou o botão (só depois de ter visto "Aguardando correção") | atualização | "Sua redação foi corrigida e não atingiu a nota necessária." / "você pode realizar a avaliação mais uma vez pelo botão abaixo." |
| Documentos aprovados | vigia do contrato | contrato liberado **e** PDF já gerado pelo Run (não avisa quem abriu o contrato pelo Flow) | atualização | "Seus documentos de matrícula foram analisados e aprovados." / "acesse a sua inscrição pelo botão abaixo e baixe o contrato da sua matrícula." |
| Pagamento liberado | vigia final | Contrato concluído **e** Pagamento com "Verificar" | **cobrança** | — (nome e valor) |
| Matrícula concluída | vigia final | Matriculado "Parabéns!" (ou Pagamento "Recebido"), só para quem o vigia viu com o pagamento pendente | atualização | "Pagamento recebido. Sua matrícula está concluída! 🎉" / "acompanhe as orientações da UniBalsas para o início das aulas." |

**Uma vez só, com novas tentativas:** cada aviso grava o momento do envio na fila; se o Blip recusar, tenta de novo (até 5 vezes; a cobrança a cada 10 min). Sem as variáveis do Blip nada é enviado (log `nao_configurado`) e os vigias seguem normalmente.

### 4.3 Cobrança com Pix

1. O vigia entra no portal como o candidato e abre o passo do pagamento (300670 no Vestibular, 300701 na Transferência).
2. Faz o que o botão "Realizar pagamento" do Pix faz no site: `button-click` do botão com lógica `P` (rádio 38702) → popup 1016 → **copia e cola** no campo 50901. Reserva: o último Pix que o portal guardou.
3. O Pix gerado fica na fila por 12 h: novas tentativas reaproveitam o mesmo código (não geram outro).
4. Envia o template de cobrança com o `order_details` em `audience.messageParams["#payment#"]`: `pix_dynamic_code` (código do TOTVS, recebedor lido do próprio código, chave `PIX_CHAVE` = CNPJ) + `payment_link` (Portal do candidato, para cartão). Valor: campo 53443 (Pix) ou 38658 (centavos). Referência `mat-{IDBOLETO}`.
5. O WhatsApp não confirma sozinho um Pix gerado por outro sistema: quem confirma é o vigia final ("Pagamento Recebido"), que manda o aviso de matrícula concluída.

Cartão nunca é digitado no WhatsApp (política da Meta): o botão "Abrir link de pagamento" leva ao portal.

### 4.4 Nome e celular

Vêm do próprio portal: `applicantData` dos passos do contrato e do pagamento (campos 38544 nome, 38546 celular) ou, na falta, a página 432 "Meus dados". Na redação, o celular informado na inscrição pelo Flow. Ficam na fila criptografada; **o celular nunca vai para os logs**.

### 4.5 Configuração no Cloud Run

| Variável | Valor |
|---|---|
| `BLIP_API_URL` | `https://unibalsasnovonegocio.http.msging.net` |
| `BLIP_BOT_KEY` | chave do bot (só no Cloud Run; nunca no repositório) |
| `PIX_CHAVE` | `07344774000189` |
| opcionais | `BLIP_TEMPLATE_ATUALIZACAO`, `BLIP_TEMPLATE_COBRANCA`, `PIX_RECEBEDOR`, `PAGAMENTO_LINK`, `BLIP_FLOW_ID` / `BLIP_STATE_ID` / `BLIP_MASTERSTATE`, `AVISOS_DESLIGADOS=1` (desliga tudo) |

Logs para acompanhar: `blip_aviso` (tipo, enviado, http, motivo), `etapa_aviso`, `redacao_vigia`, `etapa_final` (`cobranca_enviada`, `cobranca_falhou`, `pix_erro`).

### 4.6 Pontos em aberto

- **Nenhum envio real testado ainda.** No primeiro, conferir o `motivo` do `blip_aviso`. Suspeito principal: o link de pagamento (a Meta usa `payment_link.uri`; o artigo do Blip mostra `link`; o Run usa `uri`).
- O botão do Flow do template de atualização vai sem parâmetros.
- O texto de "Reprovado" da prova ainda não foi visto no portal: a reprovação é reconhecida pelo comportamento da etapa.
- Ainda **sem aviso automático**: prova liberada logo após a inscrição (a etapa 1 usa `BLIP_TEMPLATE_REDACAO`, não configurado), documento recusado e contrato recebido. O template de atualização já serve para eles.
