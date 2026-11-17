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
