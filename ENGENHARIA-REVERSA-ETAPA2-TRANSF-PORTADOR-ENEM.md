# Engenharia reversa — etapa 2 (matrícula) da Transferência, do Portador e da Nota do ENEM

Mapeado no site em 17/11/2026 com os candidatos fictícios de teste (Rebeca, Rosa Helena, Juan). Cada processo foi
seguido até a primeira espera humana. Nenhum pagamento foi feito.

## Resumo

**Conclusão:** a etapa 2 dos 3 processos é **o mesmo motor do Vestibular**: mesmos campos (`field_id`), os mesmos
7 documentos de matrícula com a mesma obrigatoriedade e o mesmo `button-click` multipart. **Mudam só os IDs de passo
e de stage.** O Flow e o Run já localizam os campos pelo rótulo (`api/matricula.js`) e o passo de documentos pelo
componente (`lerPassoDocumentos`). Basta, portanto, mapear os IDs por processo e tirar o Cupom dos 3.

| Etapa | Vestibular (20383) | Transferência (20385) | Portador (20384) | Nota do ENEM (20386) |
|---|---|---|---|---|
| Seleção resp. financeiro | 300676 | 300706 (stage 261038) | 300691 (261025) | 300722 (261052) |
| Pré-matrícula: endereço | 300666 | 300697 (261029) | 300682 (261016) | 300712 (261042) |
| Pré-matrícula: identidade | 300667 | 300698 | 300683 | 300713 |
| Cupom de desconto | 300674 | **não existe** | **não existe** | não chegou a aparecer |
| Documentos matrícula | 300671 | 300702 (261033) | 300687 (261020) | 300717 (261046) |
| Contrato | 300669 | 300700 (261031) | 300685 (261018) | 300715 (261044) |
| Pagamento | 300670 | 300701 (escondido até a baixa) | 300686 (escondido até a baixa) | ? |
| Matriculado (feedback) | — | stage 261034 | 261021 | ? |

## O que liberou a etapa 2 (a aprovação humana da etapa 1)

| Processo | Portal após a aprovação |
|---|---|
| Transferência | Documentos inscrição: **Obrigatório entregues** · Seleção resp. financeiro: Pendente [Verificar] |
| Portador | Documentos inscrição: **Obrigatórios entregues** · Seleção resp. financeiro: Pendente [Verificar] |
| ENEM | Checando as notas: **Aprovado** · Documentos inscrição: **Entregues** · Seleção resp. financeiro: Pendente |

O vigia da inscrição deve tratar como aprovado qualquer um desses textos, e também a etapa seguinte liberada, que já é a regra da 2.13.0.
O texto varia ("Obrigatório", "Obrigatórios", "Entregues").

## Passos (iguais nos 3)

1. **Seleção resp. financeiro.** Rádio 232542 com "Eu" ou "Outro", e o botão Concluir. Com "Eu", não há passo de dados do
   responsável: a Pré-matrícula abre direto.
2. **Endereço.** CEP 38568 (preenche a rua, o bairro, a cidade e a UF), Rua 38569, Número 38570, Complemento 38572,
   Bairro 38571, Cidade 38574, UF 38573, Estado natal 38641 e Cidade natal 38640. O botão é Avançar.
3. **Identidade.** RG 38642, Órgão 38643, UF do RG 38644, Cor/Raça 38645 e Estado civil 38646. Escola 38699 e Ano 38680 são
   opcionais. O botão é Concluir e volta ao portal. **Na Transferência e no Portador, a etapa seguinte é Documentos matrícula, porque não há Cupom.**
4. **Documentos matrícula.**
   - Os documentos são 1 Identidade, 2 CPF, 5 Histórico EM\*, 8 Certificado EM\*, 15 Residência, 16 Resp. financeiro e 46 Declaração EM\*.
   - O upload usa o campo 38733 e vai num único "Enviar" com `store_data=1`: botão 3940722 na Transferência, 3940589 no Portador.
   - Depois do envio, os documentos ficam com status 1 (**EM ANÁLISE**). Na Transferência, o portal mostra a etapa sem texto.
   - O Contrato fica em **"Aguardando documentação"**, e é aí que **para, na espera humana**.

## Transferência: Contrato e Pagamento (Rebeca, 17/11/2026, depois da liberação)

A equipe aprovou os documentos de matrícula. O portal mostra **Documentos matrícula: Obrigatórios entregues** e
**Contrato: Pendente [Verificar]** (`presencial/passo/300700`).

**Contrato (300700, stage 261031).** É igual ao do Vestibular.
- A tela mostra "Termos da sua matrícula" e o botão **"Clique aqui para fazer o download do contrato"** (componente 3940697).
- O texto pede para assinar no GOV.BR e mandar por e-mail para a central de matrícula. Dá o WhatsApp da equipe.
- O botão chama o `button-click`, que volta `place_id 765`, `redirect_id 54160` e o relatório RM 846 ("contrato").
  Se falhar, a mensagem é "Não foi possível gerar o contrato!".
- Depois vem o `popup` 765, **"Contrato gerado"**, com o PDF em `applicantData`, como no Vestibular (campo 52138).
- **O código atual já serve:**
  - `lerPassoContrato` acha o botão pelo rótulo.
  - `gerarContratoAgora` acha o passo pelo `cta_link` da etapa "Contrato", sem ID fixo.
  - `pdfDoPopup` lê o PDF do popup.
- **Espera humana:** a assinatura no GOV.BR, o e-mail e a baixa pela equipe. **O mapeamento da Transferência para aqui.**

**Pagamento (passo 300701, "Taxa de matrícula").**
- O passo existe e abre pela API, mas **a etapa não aparece no portal**: entre o Contrato (posição 10) e o Matriculado (12)
  falta a posição 11, escondida por regra de exibição.
- Os componentes são os mesmos do Vestibular:
  - o rádio "Meio de pagamento" (38702);
  - os botões Realizar pagamento com Pix (3940710, P) e com Cartão (3940711, C), e Gerar boleto (3940712, B);
  - os campos IDBOLETO 38656, Valor PIX 53443, Valor do boleto 38661 e Taxa em centavos 38658.
- **Todos os valores estão vazios.** O boleto ainda não foi gerado no RM. `lerPassoPagamento` acha o Pix pela lógica "P", sem ID fixo.
- **Inferência, ainda não visto:** a etapa deve aparecer depois que a equipe der baixa no contrato. Conferir na próxima liberação.
  Nenhum pagamento será feito.

**Depois da baixa do contrato pela equipe (17/11/2026, noite):**
- No portal, o **Contrato** passou para **"Assinado" [Verificar]** (feedback 920283, conclusive 1).
- A etapa **Pagamento** (stage 261032, posição 11) **apareceu**.
  - A regra é: aparece quando o campo 38651 está preenchido **e o aceite 38635 = true**.
  - Ela não tem feedback, então o portal mostra só "Pagamento", sem texto nem botão. Não há `cta_link`.
  - O Flow precisa abrir o passo 300701 direto, como faz no Vestibular, e não pelo botão do portal.
- **A tela do passo 300701** mostra "Estamos finalizando! Para concluir a sua matrícula, realize o seu pagamento".
  - O "Valor a pagar" está **vazio**.
  - O meio de pagamento tem **Cartão de crédito (já marcado) e Pix. O Boleto não aparece.**
  - Os botões são Portal do candidato e **Realizar pagamento**.
- Pela API, os campos 38702, 38656, 53443, 38661 e 38658 continuam vazios. O valor deve ser preenchido pelo RM no clique, mas isso não foi visto.
- **Parei antes de "Realizar pagamento"**: esse clique é do usuário.

**Matriculado (stage 261034, feedback 920293).** Mostra "Existem pendências". Aparece concluído quando o campo 38651 = "T".

Etapas e regras de exibição da Transferência, tiradas do `register-portal-data`:

| Posição | Etapa | Passos | Mostra quando |
|---|---|---|---|
| 0 | Inscrição | 300692-300694 | sempre |
| 3 | Documentos inscrição | 300696 | 38630 = T |
| 4 | Seleção resp. financeiro | 300706 | regras sobre 38623 e 38704 |
| 8 | Pré-matrícula | 300697, 300698 | regras sobre 38623 |
| 9 | Documentos matrícula | 300702 | 38651 preenchido |
| 10 | Contrato | 300700 | 38651 preenchido |
| 11 | (Pagamento, escondido) | 300701 | ? |
| 12 | Matriculado | — (feedback) | 38651 = T |

## Portador: Contrato e Pagamento (Rosa, 17/11/2026, depois da liberação)

**O Portador é idêntico à Transferência.**

- **No portal:** Documentos matrícula aparece como "Obrigatórios entregues" e o Contrato como "Pendente [Verificar]" (`passo/300685`, stage 261018).
- **Contrato:**
  - O botão de download é o 3940564. Gera o relatório RM 846 e abre o popup 765, "Contrato gerado".
  - Gerei o contrato e não assinei.
- **Campos ocultos do contrato:** são os mesmos nos 3 processos, Vestibular 300669, Transferência 300700 e Portador 300685.
  - O checkbox "Declaro que li e estou de acordo" (38635) só aparece se a data de assinatura (38636) estiver vazia.
  - O IP de aceite é o campo 52136, que o `dadosDoContrato` já preenche pelo rótulo.
- **Pagamento: passo 300686, "Taxa de matrícula".**
  - Os componentes são os mesmos da Transferência: o rádio 38702, os botões Pix (P), Cartão (C) e Boleto (B), e os campos 38656, 53443, 38661 e 38658.
  - Os valores estão vazios. A etapa (posição 11) fica escondida no portal.
- **Matriculado:** stage 261021. Mostra "Existem pendências" e conclui quando o campo 38651 = "T".
- **Outros passos do Portador, achados pela API e fora do caminho "Eu":**
  - 300684 e 300690: dados do responsável "Outro".
  - 300688: boleto da inscrição, que só gera o boleto.
  - 300689: filiação, "Cadastrar filiação".

Tabela atualizada: **Pagamento da Transferência = 300701; Pagamento do Portador = 300686.**

**Depois da baixa do contrato (18/11/2026):** o Portador ficou igual à Transferência.
- **Portal:** os documentos de matrícula aparecem como "**Entregues**" (texto diferente do da Transferência, e sem cta) e o Contrato como "**Assinado**" [Verificar].
- **A etapa Pagamento (stage 261019, posição 11) apareceu.** Ela não tem feedback nem botão e aparece quando o aceite 38635 = true.
- **Passo 300686:** mostra "Estamos finalizando!" e o "Valor a pagar" vazio. As opções são **Cartão de crédito (já marcado) e Pix**; não há Boleto. O botão é "Realizar pagamento".
- **Parei antes do pagamento, como combinado:** não vamos pagar de verdade. O Pix já foi simulado, e o Matriculado é liberado à mão pela equipe.

## Onde cada um parou

- **Transferência (Rebeca):**
  - Os documentos foram aprovados.
  - O contrato foi gerado no site (popup "Contrato gerado") e não foi assinado.
  - Espera a assinatura no GOV.BR, o e-mail e a baixa pela equipe para o Pagamento (300701) aparecer.
- **Portador (Rosa):** igual à Rebeca. Contrato "Assinado", e a tela de Pagamento (300686) foi aberta. **Concluído**, já que não vamos pagar.
- **Nota do ENEM (Juan): bloqueado na identidade (300713).**
  - O "Concluir" responde `{"success":false,"data":"Não foi possível fazer a matrícula!"}` (HTTP 200).
  - Aconteceu 3 vezes, inclusive depois de recarregar a página.
  - Os dados ficam gravados (voltam preenchidos), mas o passo não avança. **O site não mostra mensagem nenhuma.**
  - É a integração de matrícula com o RM que recusa. Precisa da equipe da UniBalsas.
  - Os docs e o contrato do ENEM ainda não foram vistos.
  - **Nova tentativa (17/11/2026, noite), uma só:**
    - Os dados estavam preenchidos: RG, SSP, Acre, Parda e Solteiro.
    - O clique foi recusado com o mesmo `success:false`, "Não foi possível fazer a matrícula!", e o portal segue em "Pré-matrícula: Pendente".
  - **Diagnóstico para a equipe:**
    - O botão Concluir do ENEM (3940819) tem **a mesma configuração** do Portador (300683), que funcionou: as mesmas 9 ações TOTVS, na mesma ordem.
      - Salvar Dados 96153.
      - Executar processo 96154, se 38593 estiver vazio.
      - Consulta 225276 por CPF.
      - Processo 96155 ou 96156, conforme 38704 = 17 ou 18.
      - Consulta 96157, por IDPERLET + CPF + IDHABILITACAOFILIAL.
      - Salvar 195250 e 1109063.
      - Processo 238894.
    - Portanto, **a falha não é do site**. É no RM, com os dados do processo ENEM (período letivo, habilitação ou oferta de Psicologia Noturno) ou com o cadastro do Juan (CODUSUARIOPS 20172).
    - A equipe precisa ver o log da integração no RM ou no Rubeus para esse CPF.
  - **Mais 2 tentativas, a pedido do usuário ("conclua o Juan"):**
    - Uma com os dados como estavam.
    - Outra preenchendo também os opcionais Escola de Ensino Médio (IFMA) e Ano de conclusão (1998).
    - As duas tiveram a mesma recusa, então os opcionais **não** são a causa. Juan fica parado até a equipe corrigir o RM.
  - **18/11/2026: a equipe corrigiu o RM.** A Pré-matrícula do Juan aparece como **Concluída**.
    - Etapas do ENEM:
      - Inscrição (261039)
      - Checando as notas (261049, passo 300719)
      - Documentos inscrição (261041, passo 300711)
      - Resp. financeiro (261052, passo 300722)
      - Pré-matrícula (261042, passos 300712 e 300713)
      - **Documentos matrícula (261046, passo 300717)**
      - **Contrato (261044, passo 300715)**
    - **Não há Cupom.** O Pagamento e o Matriculado só aparecem depois do aceite.
    - **Docs de matrícula (300717):** os mesmos 7 documentos, no campo 38733. Os obrigatórios são Histórico, Certificado e Declaração do EM.
    - Enviei 3 PDFs de teste. O `button-click` voltou `success:true` (redirect 54163, stage 261046). O portal mostra os Documentos matrícula sem texto (em análise) e o Contrato como "Aguardando documentação". **Espera humana.**

## Para o Flow e o Run

- **IDs de passo por processo:** o que estava fixo com os números do Vestibular passa a vir de uma tabela por processo (a de cima).
  Antes de implementar, conferir no código onde há IDs fixos (`api/etapa2-matricula.js` e `api/matricula.js`).
- **Cupom:** não existe na Transferência nem no Portador. A tela `MATR_CUPOM` só aparece no Vestibular.
- **Falha da matrícula no RM:** o `button-click` pode voltar `success:false` com "Não foi possível fazer a matrícula!".
  - O Run deve tratar como **recusa definitiva**, sem repetir, e mostrar ao candidato que a matrícula está em conferência.
  - O Run deve avisar a equipe.
  - Hoje o site fica parado sem avisar.
- **Aprovação da etapa 1:** reconhecer "Obrigatório(s) entregues", "Entregues" e "Aprovado" (ENEM).

## Implementação no Run/Flow (18/11/2026, sem commit)

- `api/processes.js`: `passoPagamento(processo)` — Vestibular 300670, Transferência 300701, Portador 300686, ENEM 300716 (provisório, conferir quando o Juan chegar no pagamento).
- `api/etapa2-matricula.js`:
  - `pagamentoLiberado(rows, processo)`: contrato concluído + Pagamento pendente; passo do botão do portal ou, sem botão, da tabela. Usado pelo vigia final (cobrança Pix) e pela lista de status ("Pendente [Pagar]").
  - `aguardandoEquipe(rows)`: Pagamento "Recebido" + Matriculado pendente → a lista mostra "Aguardando confirmação da equipe"; o vigia grava `pagamento_recebido_em` e manda o aviso `pagamento_recebido` (só se o Run viu o pagamento pendente). Matriculado continua manual.
  - Recusa do RM ("Não foi possível fazer a matrícula!"): a fila vai para `conferir` (motivo `rm_recusou`, log `etapa2_fila_atencao` para a equipe), a Pré-matrícula mostra "Em conferência pela equipe" e, depois de 30 min, o próximo login/atualização retoma o envio.
  - Login rápido: com status guardado, espera o portal só 2 s (`ETAPA2_ESPERA_CACHE_MS`) e abre com o guardado; o Run relê o portal em 2º plano (`etapa2_status`) e religa os vigias. Run continua com mínimo 0 (Cloud Tasks).
- `api/flow.js`: o erro do Rubeus agora carrega a mensagem (`json.message`) para reconhecer a recusa do RM.
- Verificado localmente (`.claude/skills/verify/final.mjs`): Rebeca → Pagamento Recebido / Matriculado "Aguardando confirmação da equipe", `pagamento_recebido`; Rosa → Pagamento "Pendente [Pagar]", vigia `pagamento_liberado` pelo passo 300686; 2º login ~4,5 s com o status guardado. Sem Blip, nenhum Pix gerado.
