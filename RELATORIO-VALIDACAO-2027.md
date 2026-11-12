# Relatório de validação — Flow UniBalsas, Vestibular Online 2027/1

Data: 10/11/2026 · Base: v1.6.15 (pasta `release_1.6.5`) · Mapeamento técnico: `ENGENHARIA-REVERSA-VESTIBULAR-2027.md` (seção 6 = reverificação de hoje) e `ENGENHARIA-REVERSA-VESTIBULAR-DOCUMENTOS-MATRICULA.md`.

## O que já existia
Flow completo (dados básicos → curso/turno → "Estamos quase lá" → redação → acompanhamento → matrícula/documentos), fila durável (Firestore + Cloud Tasks), estado selado, políticas por processo, 128 testes.

## O que foi feito hoje
- **Reverificação no site oficial** (processo 20383), com envios bloqueados no navegador, sem gravar dados: contrato do `button-click` (multipart), campos do passo 300661, estrutura do passo 300662, portões de acesso por passo.
- **Teste novo** `test/site-parity.test.js`: o `/submit` do passo 1 tem os mesmos campos/valores do site (celular só dígitos, IDPS `223`, gênero `F`/`2`, data ISO, LGPD `true`/`1`/`4`).
- **Documentação corrigida**: README (versão 1.6.15), mapeamento de 09/11 (Turno existe no Flow; celular já é só dígitos; "Como ficou sabendo" vazio também no site).
- Nenhum código de produção foi alterado: a comparação não achou divergência a corrigir nos passos verificados.

## Resultados
| Item | Estado | Evidência |
|---|---|---|
| Suíte local (130 testes) | VALIDADO | `node --test "test/*.test.js"` |
| Passo 1 (dados básicos): payload igual ao site | VALIDADO | captura do `button-click` + `site-parity.test.js` |
| Seleção do processo 2027/1 e lista de 4 processos | VALIDADO | site: Vestibular, Transferência, Portador de Diploma, ENEM |
| Passo 2: Curso e Turno como selects obrigatórios; opções dependem do IDPS gravado | VALIDADO (estrutura) | `query_data` = "Nada encontrado na base TOTVS" sem o passo 1 persistido |
| Passos 2 e 3: payload do site igual ao do Flow (inclui 319427) | VALIDADO | inscrição real de teste (applyment 14163942) + `site-parity.test.js` |
| Inscrição concluída, portal "Concluída / Prova disponível", redação até "Aguardando correção" | VALIDADO em 10/11 | applyment 14163942; seção 7 do mapeamento |
| Todos os botões do portal e da avaliação (Editar, Meus dados, Nova inscrição, Sair, Iniciar, Salvar/Continuar, Finalizar, Ver informações) | VALIDADO | seção 7 |
| Etapa assíncrona (correção da redação) | VALIDADO o estado "Aguardando correção"; a aprovação em si é PENDENTE (manual da equipe) | `aguardando-correcao.test.js`; depende de a equipe corrigir, sem polling automático: o candidato retoma por "Atualizar situação" |
| Documentos de matrícula (upload) | BLOQUEADO | `/submit` oficial devolve HTTP 500 em qualquer corpo (1.6.12–1.6.15); API `/blip/documents` não confirmada no portal |
| "Como você ficou sabendo": envio igual ao do site (319427=`01`) | VALIDADO | captura do passo 3 |
| "Como você ficou sabendo": exibição no CRM | PENDENTE | vazio no CRM também na inscrição pelo site em 09/11; precisa de acesso ao CRM para a inscrição 14163942 |
| Teste na prévia/aparelho real da Meta, logs de produção desta versão | PENDENTE | fora do alcance desta sessão (sem credenciais do Cloud Run) |

## Limitações
- Foi criada **uma** inscrição de produção identificada como teste (applyment 14163942, CPF sintético, e-mail `@example.com`), a pedido do responsável; outras três inscrições de teste (Caleb, Matheus, Laura) foram fornecidas pelo usuário. Até 12/11/2026 foram enviados documentos de teste (PDF "DOCUMENTO DE TESTE - NAO VALIDO") e gerado o contrato da Helena; nenhum pagamento foi concluído (o Pix falhou no site). A redação enviada é fictícia e termina com "Teste". As inscrições de teste são apagadas pela equipe.
- O Flow não tem "salvar rascunho" da redação (o site tem); "Meus dados" e "Editar curso/turno" do portal também não existem no Flow.
- As chamadas do Flow vão ao Rubeus oficial (`admin.portal.apprbs.com.br`: `/form`, `/submit`, `/data-source`), não ao `button-click` do site; a paridade foi comprovada por campos e valores, não por requisição idêntica.
- Tokens, cookies e IDs de sessão capturados não foram gravados em nenhum arquivo.

## Atualização 12/11/2026 — jornada completa até o pagamento
Mapa consolidado em `MAPA-JORNADA-2027.md`.

| Item | Estado |
|---|---|
| Login, resp. financeiro, endereço, identidade (4 processos) | VALIDADO no site (envios reais, RA gerado) |
| Documentos de inscrição e de matrícula (formato `file_N`) | VALIDADO no site (4 candidatos, "Em análise"/"Entregues") |
| Contrato: geração e entrega do PDF (campo 52138) | VALIDADO no site · Flow: PENDENTE |
| Taxa de matrícula (Pix) | BLOQUEADO — "Não foi possível realizar o pagamento com o PIX!" |
| Flow envia CEP e idade no endereço | PENDENTE — não envia (corrigir) |
| Flow mantém RG com letra / ano de conclusão opcional | PENDENTE — corrigir |
