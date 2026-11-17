# Revisão da arquitetura — Flow UniBalsas 2027/1 (versão 2.11.0, 17/11/2026)

Documento para quem continuar o projeto (pessoa ou IA). Explica como o sistema funciona, o que é feito ao vivo e o que é feito em segundo plano, onde há redundância e onde ainda há risco.

## 1. Peças

| Peça | Papel |
|---|---|
| **WhatsApp Flow** (JSON único `flows/etapa1-vestibular.json`, colado na WABA) | Só telas. Listas fixas (UF, cor/raça, estado civil, documentos) vêm prontas no JSON; listas que mudam (cursos/turnos, escolas) vêm do cache do Run. Cada tela manda os dados ao Run (`data_exchange`). |
| **Google Cloud Run** (`/api/flow`, mínimo de 0 instâncias) | Recebe cada tela, valida, **grava no Firestore e responde na hora**. Desliga sozinho quando ninguém usa (escala para zero); acorda com a próxima requisição. |
| **Firestore** (`inscricoesFila`, `matriculaFila`, `flowCache`, `contratoLinks`, `contratos`…) | Fila durável. Tudo o que o candidato preencheu fica guardado (criptografado) até chegar ao Rubeus. |
| **Cloud Tasks** (fila `unibalsas-flow`) | Agenda o **worker** do Run (`/internal/flow-worker`, assinado por HMAC) — envio ao Rubeus, novas tentativas, vigias. Acorda o Run mesmo com zero instâncias. |
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
- pelos **vigias** (Cloud Tasks), que conferem o portal: contrato (a cada 10 min nas 2 primeiras horas, depois de hora em hora, por até 15 dias) e etapa final (de hora em hora, por até 30 dias). Quando algo muda, o Run guarda o novo status e o momento (é aí que entram os avisos pelo WhatsApp).
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
**Não.** O maior caso é o login (login + status com teto de 7,5 s somados). Tudo o que demora — gravar passos (até 15 s por passo), gerar o contrato no TOTVS (~14,5 s), gerar o Pix (~5 s), ler as etapas do portal (~12–16 s) — roda no worker/vigias ou no navegador. Atenção só ao **primeiro acesso depois de parado** (Cloud Run acordando, +1–3 s) somado a um login lento.

### 9. "Ao logar, a primeira tela é sempre o Status, com o botão da próxima etapa disponível?"
**Sim (versão 2.10.0+).** Login → tela de status igual ao Portal do candidato (lista: ✅ concluída / ❗ pendente, com o status do site e o botão "Verificar" nas etapas abertas). Tocar numa etapa aberta leva à sua tela. Exceções intencionais:
- **Prova liberada** → vai ao "Portal do candidato" da etapa 1 ("Realizar prova"), que é a própria tela de status da etapa 1 (a etapa 1 não foi alterada);
- **Portal lento e sem status salvo** → tela "Estamos buscando a situação da sua inscrição…" com **Atualizar**.

## 3. Etapas, quem libera e o que o Run faz

| Etapa (portal) | Quem libera | No Flow | No Run (segundo plano) |
|---|---|---|---|
| Inscrição | candidato | telas de inscrição | grava no Rubeus |
| Prova online | candidato | redação | espera 10 min, confere a prova 2× e envia |
| — correção da redação | **equipe** | status "Aguardando correção" | — |
| Resp. financeiro / Pré-matrícula | candidato | telas da matrícula | grava passo a passo |
| Documentos matrícula | candidato | 7 telas (3 obrigatórios) | envia pelo passo do site (multipart) e confere "Em análise" |
| — análise dos documentos | **equipe** (até 48 h úteis) | status "Em análise" | vigia do contrato |
| Contrato | candidato (baixa, assina no GOV.BR e envia por e-mail) | tela do site + link exclusivo do PDF | gera e guarda o PDF ao liberar |
| — conferência do contrato assinado | **equipe** | status | vigia final |
| Pagamento | candidato (Pix ou cartão) | orientação do site (fora do Flow) | registra "pagamento liberado" |
| — confirmação do pagamento | TOTVS | status | registra "matrícula concluída" |
| Matriculado ("Parabéns!") | — | status ✅ | fim da jornada |

## 4. Modelo de mensagem (template) para aprovar na Meta — avisos de etapa

Um único template de **Utilidade** cobre todos os momentos que dependem da equipe. As variáveis recebem frases curtas (a Meta não aceita quebra de linha, tabulação nem mais de 4 espaços seguidos dentro de uma variável; o texto não pode começar nem terminar com variável).

- **Nome:** `unibalsas_atualizacao_processo` · **Categoria:** Utilidade · **Idioma:** Português (BR)
- **Cabeçalho (texto):** `UNIBALSAS Informa`
- **Corpo:**
```
Olá, {{1}}! 👋

Temos uma atualização no seu processo de {{2}}:

✅ {{3}}

Próximo passo: {{4}}

Toque no botão abaixo para continuar pelo WhatsApp. Se tiver dúvidas, é só responder esta mensagem.
```
- **Rodapé:** `UniBalsas - Centro Universitário`
- **Botão:** tipo **Flow** — texto `Acessar minha inscrição`, Flow `etapa1-vestibular`, ação `navigate`, tela `INSC_INICIO`.

**Exemplos de preenchimento** (exigidos na aprovação; a Meta pede um exemplo por variável):

| Momento | {{1}} | {{2}} | {{3}} | {{4}} |
|---|---|---|---|---|
| Prova liberada | Maria | inscrição no Vestibular 2027/1 | Sua inscrição foi concluída e a avaliação online já está disponível. | faça a sua redação pelo botão abaixo. |
| Redação aprovada | Maria | inscrição no Vestibular 2027/1 | Sua redação foi corrigida e você foi aprovada! 🎉 | informe o responsável financeiro, seus dados e envie os documentos da matrícula. |
| Redação não aprovada | Maria | inscrição no Vestibular 2027/1 | Sua redação foi corrigida e não atingiu a nota necessária. | você pode realizar a avaliação mais uma vez. |
| Documentos aprovados | Maria | matrícula | Seus documentos de matrícula foram analisados e aprovados. | baixe o seu contrato, assine pelo GOV.BR e envie para a central de matrícula. |
| Documento recusado | Maria | matrícula | Um ou mais documentos da sua matrícula precisam ser reenviados. | veja o motivo e envie o documento novamente. |
| Contrato recebido | Maria | matrícula | Recebemos o seu contrato assinado. | realize o pagamento da taxa de matrícula. |
| Matrícula concluída | Maria | matrícula | Pagamento recebido. Sua matrícula está concluída! 🎉 | acompanhe as orientações da UniBalsas para o início das aulas. |

**Mensagem de pagamento** (template separado, tipo **Detalhes do pedido / order_details**, enviado pela API de mensagens ativas do Blip): "Taxa de matrícula — R$ {valor}", com Pix (código copia e cola gerado no TOTVS) e link do Portal do candidato para cartão. Ver a seção 17 da engenharia reversa.

**O que o Run precisa para disparar:** `BLIP_API_URL` e `BLIP_BOT_KEY` (chave do bot roteador) no Cloud Run, os nomes dos templates aprovados e, para o pagamento, nome do recebedor + chave Pix (CNPJ) da conta que recebe o Pix do TOTVS.
