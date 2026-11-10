# Checklist - testes do FLOW UniBalsas 1.6.6 (documentos da inscrição, um só Flow)

FLOW: DevRubeusFlows, ID 1295030755786589, JSON 7.3 / Data API 3.0. Servidor esperado em `GET /api/flow`: `unibalsas-cloudrun-jornada-1.6.6`. O JSON da WABA **muda** nesta versão: importar o `flow-waba.json` novo antes de testar.

**O que mudou na 1.6.6**
1. Corrige `Component Validation Error: Dropdown should NOT have additional properties (descricao)` na tela `DOCUMENTOS_INSCRICAO`. Todas as listas de opções saem só com `{id,title}`.
2. A tela de documentos mostra o progresso ("N de M documentos enviados. Falta: …") e só conclui quando todos os documentos da lista foram enviados.
3. Com todos enviados, a tela esconde Documento/Arquivo, mostra "Documentos enviados ✅" e o rodapé vira **Atualizar situação**.

**Como testar:** prévia interativa do Gerenciador do WhatsApp, modo interativo ligado, dados fictícios (4Devs). Arquivos de teste: PDF/JPG/PNG pequenos, identificados como teste (por exemplo, o texto "ARQUIVO DE TESTE - NAO VALIDO"). Gravar anotando horário e resultado de cada passo.

Legenda: ESPERADO = comportamento que deve ser observado; REGISTRAR = anotar o que aconteceu; BLOQUEIO = interromper e relatar.

## 0. Preparação

- [ ] Importar `flow-waba.json` da 1.6.6 na WABA e publicar; conferir "zero erros" no meta.
- [ ] `GET /api/flow` responde `version: unibalsas-cloudrun-jornada-1.6.6`.
- [ ] `npm test` local: 104 testes passando.
- [ ] Ligar o modo interativo (não clicar em Executar durante o teste; ele desativa o modo).
- [ ] Ter uma inscrição concluída por modalidade (ou usar as já existentes: Transferência 14150234, Diploma 14150338, ENEM 14150473).

## 1. Transferência (processo 20385, protocolo 14150234)

Caminho: ESCOLHA_PROCESSO → "Já sou inscrito" (CPF 389.637.573-31, nascimento 05/10/1982) → Ver minhas etapas → Continuar: Documentos inscrição → Verificar andamento.

- [ ] ESPERADO: `DOCUMENTOS_INSCRICAO` abre **sem** erro de componente. O Dropdown lista "HISTÓRICO ACADÊMICO". Antes da correção: erro `descricao`.
- [ ] ESPERADO: texto "Envie todos os documentos pelo WhatsApp: …" e progresso "0 de 1 documentos enviados. Falta: HISTÓRICO ACADÊMICO."
- [ ] ESPERADO: seletor aceita PDF, JPG, PNG; recusa outro tipo e arquivo acima de 740 KB (mensagem do WhatsApp ou do servidor "maior que 740 KB").
- [ ] Selecionar HISTÓRICO ACADÊMICO + anexar PDF de teste → Enviar documento → "Só um instante ⏳ Recebendo seu documento" → Verificar andamento.
- [ ] ESPERADO: "✅ HISTÓRICO ACADÊMICO recebido (…pdf). Recebemos a confirmação do envio; a equipe vai conferir o documento."
- [ ] ESPERADO: com todos os documentos **da lista** enviados, a tela mostra "Documentos enviados ✅", sem Dropdown nem seletor, e o rodapé "Atualizar situação".
- [ ] Atualizar situação → ESPERADO: sai da tela de documentos (STATUS_FINAL "Tudo em dia" ou próxima etapa disponível), sem erro.
- [ ] Reenvio do mesmo documento (antes de concluir): ESPERADO "atualizado" e o contador **não** conta duas vezes.
- [ ] **PONTO CRÍTICO:** o portal (`passo/300696`) lista **3** documentos (Histórico, Planos de Ensino, Declaração de Vínculo) e só muda de "Pendentes" para "Em análise" com os três. A API `/rm/documents` (idps 225, conferida em 09/11/2026) devolve **somente o Histórico**. REGISTRAR: depois do envio pelo Flow, o painel do portal mostra "Pendentes" ou "Em análise"? Esperado hoje: **Pendentes**, até a UniBalsas expor os outros dois CODDOCUMENTO.
- [ ] REGISTRAR: o documento aparece no RM/Portal como "EM ANÁLISE" com o nome `HISTÓRICO ACADÊMICO.pdf`.

## 2. Portador de Diploma (processo 20384, protocolo 14150338)

- [ ] ESPERADO: Dropdown com "DIPLOMA DE GRADUAÇÃO" (ID 10), sem erro de componente.
- [ ] Enviar PDF de teste. ESPERADO: recebido, progresso "1 de 1", tela concluída, rodapé "Atualizar situação".
- [ ] Atualizar situação. ESPERADO: sem erro; se o portal ainda mostrar pendências, o painel indica.

## 3. Nota do ENEM (processo 20386, protocolo 14150473)

- [ ] ESPERADO: Dropdown com "BOLETIM NOTA ENEM" (ID 25), sem erro de componente.
- [ ] Enviar PDF/JPG/PNG de teste. ESPERADO: recebido, progresso "1 de 1", tela concluída.
- [ ] REGISTRAR: etapa "validação das notas" segue em validação externa; não declarar aprovada.

## 4. Vestibular Online (processo 20383)

- [ ] ESPERADO: não pede documentos na inscrição (`/rm/documents` do idps 223 vem vazio). A tela de documentos não deve aparecer; se aparecer a tela genérica ETAPA_PORTAL, é o comportamento antigo e está correto.
- [ ] Regressão: redação enviada → ACOMPANHAMENTO "Prova online: Aguardando correção" → Encerrar → STATUS_FINAL.

## 5. Regressão das demais listas (Dropdown)

Percorrer ao menos uma vez e confirmar que **nenhuma** tela exibe erro de componente:
- [ ] Cursos, turnos e anos do ENEM (CURSO_INGRESSO, CURSO_ENEM).
- [ ] Origem (QUASE_LA).
- [ ] Responsável financeiro, UFs, cidades, raça, estado civil, anos, escolas (RESP_FINANCEIRO, RESP_DADOS, ENDERECO, IDENTIDADE), se a etapa estiver liberada.
- [ ] Lista de processos (ESCOLHA_PROCESSO).

## 6. Segurança e limites (não podem regredir)

- [ ] O estado selado (`estado`) não contém `arquivo`, chaves de criptografia nem `descricao` no payload visível ao cliente.
- [ ] Limite 740 KB e tipos PDF/JPG/PNG preservados no seletor e no servidor.
- [ ] Clique repetido em Enviar documento não gera segundo POST (mesmo job).
- [ ] Falha de rede no POST: mensagem "Confira no Portal do candidato antes de enviar de novo" (o RM pode ter gravado).
- [ ] Sem a inscrição ou sem CPF na sessão: mensagem pedindo "Já sou inscrito".

## 7. Itens que dependem de terceiros (não aprovar sem evidência)

- [ ] PENDENTE (UniBalsas): `CODDOCUMENTO` e inclusão no `/rm/documents` dos documentos "PLANOS DE ENSINO (EMENTAS)" e "DECLARAÇÃO DE VINCULO ACADÊMICO" na Transferência. Sem isso o Flow não consegue concluir a etapa do portal.
- [ ] PENDENTE (Blip): um Flow só (dinâmico, `data_exchange`). O arquivo vai da Meta direto ao `/api/flow` (`cdn_url` + `encryption_metadata`) e o servidor decifra. Confirmar, no teste real pelo Blip, que a tela de documentos abre sem erro e que o envio retorna "recebido". Se travar, registrar a mensagem e o log do Cloud Run (sem links com `sig=`).
- [ ] PENDENTE: teste em aparelho WhatsApp real (a prévia não valida o DocumentPicker nativo).
- [ ] PENDENTE: confirmação no RM de que o documento recebido via `/blip/documents` aparece como não entregue (ENTREGUE=F) até conferência manual.

## Resultado esperado em uma linha

Nas três modalidades que pedem documento, a tela de documentos abre sem erro, aceita o arquivo, informa o progresso e, ao enviar tudo o que a API lista, deixa de oferecer envio e passa a "Atualizar situação". O status do portal só muda para "Em análise" quando todos os documentos exigidos pelo portal estiverem gravados.

## Cadastros fictícios de referência

| Modalidade | Nome fictício | CPF | Nascimento | Protocolo |
|---|---|---|---|---|
| Vestibular Online | Nicole Catarina Olivia Peixoto | 630.605.836-25 | 14/01/1947 | Não registrado |
| Transferência | Caleb Tomás Melo | 389.637.573-31 | 05/10/1982 | 14150234 |
| Portador de Diploma | Matheus Erick Pereira | 210.957.564-60 | 02/03/1979 | 14150338 |
| Nota do ENEM | Laura Débora Ayla Silveira | 369.443.986-21 | 25/07/1975 | 14150473 |

Rastros: a inscrição 14150234 tem 3 PDFs de teste gravados em 09/11/2026 (Histórico, Planos de Ensino e Declaração de Vínculo), hoje "Em análise". A equipe da UniBalsas pode recusá-los ou removê-los no RM.
