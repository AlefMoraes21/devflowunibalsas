# Engenharia do Flow: Transferência, Portador de Diploma e Nota do ENEM (etapa 1)

Projeto das telas e do trabalho do Run para os 3 processos de inscrição direta. A base são os mapeamentos de 17/11/2026:
- `ENGENHARIA-REVERSA-TRANSFERENCIA-DOCUMENTOS.md`
- `ENGENHARIA-REVERSA-PORTADOR-DIPLOMA.md`
- `ENGENHARIA-REVERSA-NOTA-ENEM.md`

**Status (17/11/2026):** **implementado na 2.13.0, NÃO publicado** (aguardando "publicar"). Entraram V1 e V3; V2 (5 MB) fica para homologar. Diferenças do projeto: as telas de documento chamam-se `INSC_DOC_A/B/C` (a Meta não aceita número no id) e o fim é `INSC_DOCS_FIM` (logo "Documentos de inscrição"); a lista de status do LOGIN ganhou ícones por status (`start.image`, `flows/img/icone_*.png`), porque a NavigationList não aceita imagem solta na tela.

Princípios, os mesmos do Vestibular:
- Igual ao site, sem inventar etapas.
- Cada tela grava no Firestore e responde na hora.
- O Run faz cerca de 98% do trabalho em segundo plano: worker, Cloud Tasks e vigias.
- Chamadas ao vivo ao Rubeus só em dois momentos: no início (cache de cursos e checagem de duplicidade, que já existem) e no LOGIN.

---

## 1. Como o LOGIN funciona (testado de novo em 17/11/2026)

Saí do portal, limpei a sessão e entrei de novo com o Juan (ENEM) e com a Rosa (Portador). O site **sempre abre na página de status**. A sequência é a mesma do Vestibular:

| # | Chamada | Tempo | O que devolve |
|---|---|---|---|
| 1 | `login-portal` (CPF + nascimento) | 2,0 s | `person_id`, `applyment_id`, `session_id` |
| 2 | `settings/selective-process` | 0,08 s | `selective_process_id` (20386) |
| 3 | `check-login` | 0,1 s | nome e CODUSUARIOPS |
| 4 | `person-applyment` | 0,15 s | inscrições da pessoa |
| 5 | `register-portal-data` | **6,7 s** | etapas (`stages`) com `feedback.complementary_text` (o status) e `cta_link`/`cta_text` (o botão) |

Quem calcula o status é o servidor do Rubeus, pelas regras de cada etapa:
- **"Checando as notas"** só aparece quando o campo 38744 = `T` (ENEM). O status "Validando" corresponde ao campo 38623 = `0`.
- **"Documentos inscrição"** só aparece quando o campo 38630 = `T`. O status "Em análise" corresponde ao campo 38605 = "Em analise".
- Status hoje:
  - Rosa: Inscrição **Concluída** · Documentos inscrição **Em análise**
  - Juan: Inscrição **Concluída** · Checando as notas **Validando** · Documentos inscrição **Em análise**
  - A equipe ainda não liberou nada.

**O Flow já faz isso** (`etapa2-matricula.js`, `MATR_LOGIN` → `MATR_STATUS`):
- Faz o login ao vivo.
- Espera o portal até cerca de 6,5 s. Se o portal não responder a tempo, usa o último status salvo e busca o atual em segundo plano.
- Mostra a lista de etapas igual à do portal. Só as etapas abertas (com botão) levam a uma tela.

Essa lógica continua igual. O que falta para os 3 processos está na seção 5.

> Atenção: login de 2 s mais portal de 6,7 s passa do limite de 6,5 s. No primeiro login de um candidato desses processos, sem status salvo, ele veria "Buscando… Atualizar". O plano da seção 4.4 resolve isso salvando o status antes, pelo worker.

---

## 2. Jornada no Flow, tela a tela

```
INSC_INICIO ─ INSC_DADOS ─ INSC_PRIVACIDADE ─┬─ INSC_CURSO ───────┬─ INSC_QUASE_LA ─ INSC_CONCLUIDA ─ INSC_STATUS ─ INSC_DOC_1 ─ (INSC_DOC_2 ─ INSC_DOC_3) ─ INSC_FIM
      (iguais ao Vestibular)                 └─ INSC_CURSO_ENEM ──┘   (igual)        (igual)          (nova)       (novas, por posição)            (igual)
                                                (nova, só ENEM)
```

| # | Tela | Origem | O que mostra / faz | Chamada ao vivo |
|---|---|---|---|---|
| 1 | `INSC_INICIO` | reaproveitada | Escolha do processo | não |
| 2 | `INSC_DADOS`, `INSC_PRIVACIDADE` | reaproveitadas | Dados básicos (o site é igual nos 4 processos) | não |
| 3a | `INSC_CURSO` | reaproveitada | Curso e turno (Transferência e Portador) | não (cache) |
| 3b | **`INSC_CURSO_ENEM`** | **nova**, cópia da INSC_CURSO com o bloco do ENEM | Curso e turno + nº de inscrição + ano + 5 notas, como no site (passo 300708) | não (cache) |
| 4 | `INSC_QUASE_LA` | reaproveitada | CPF, nacionalidade, ensino médio, deficiência, origem → **Concluir** | sim, a de hoje (duplicidade no RM) |
| 5 | `INSC_CONCLUIDA` | reaproveitada, sem mudar o texto | "✅ Obrigado pelo seu cadastro!" → **Acessar Portal do Candidato** | não |
| 6 | **`INSC_STATUS`** | **nova**, mesmo layout da `MATR_STATUS` (NavigationList) | O status que o site mostra logo depois de concluir (tabela abaixo) | não |
| 7 | **`INSC_DOC_1..3`** | **novas**, mesmo layout das `MATR_DOC_*` | Um documento por tela, com o título vindo dos dados | não (só Firestore) |
| 8 | `INSC_FIM` | reaproveitada (título + mensagem) | Recebimento e fecha a etapa 1 | não |

**INSC_STATUS**: mostra o que o site mostra logo após concluir. Não é uma leitura do portal, porque nesse momento o worker ainda está gravando no Rubeus.

| Processo | Linhas |
|---|---|
| Transferência / Portador | ✅ Inscrição · Concluída — ❗ Documentos inscrição · Pendentes **[Verificar]** |
| ENEM | ✅ Inscrição · Concluída — ❗ Checando as notas · Validando — ❗ Documentos inscrição · Pendentes **[Verificar]** |

Tocar em "Documentos inscrição" abre `INSC_DOC_1`. Tocar nas outras linhas não faz nada, como no site.

**Telas de documento (lista por processo, igual ao site):**

| Processo | INSC_DOC_1 (obrigatório) | INSC_DOC_2 | INSC_DOC_3 |
|---|---|---|---|
| Transferência | 28 Histórico acadêmico \* | 29 Planos de ensino (ementas) | 27 Declaração de vínculo acadêmico |
| Portador | 10 Diploma de graduação \* | 17 Histórico da graduação | 26 Certidão de conclusão – graduação |
| ENEM | 25 Boletim nota ENEM \* | — | — |

- Nos 3 processos, o 1º documento é o único obrigatório. Por isso a `INSC_DOC_1` tem `min-uploaded-documents: 1` e as `INSC_DOC_2`/`3` têm `0` (botão **Avançar**, que também serve para pular).
- As telas são separadas por posição, e não uma tela só que se repete, para o seletor de arquivo vir vazio em cada documento.
- O título, a legenda ("Obrigatório. Documento 1 de 3.") e o texto do botão vêm dos dados. **O rótulo dinâmico no Footer precisa ser conferido no editor da Meta.** Se não for aceito, o botão fica "Avançar" fixo.
- Texto do topo, adaptado das regras do site para o celular: "Envie o arquivo com todas as páginas (frente e verso). PDF, JPG ou PNG. A análise ocorre em até 48 horas úteis."

**INSC_FIM:**
- Transferência / Portador: título "Documentos enviados". Mensagem: "Recebemos seus documentos. A análise ocorre em até 48 horas úteis. Avisaremos por aqui quando houver novidade."
- ENEM: a mesma mensagem, mais "Suas notas do ENEM estão em validação."
- O texto confirma só o recebimento, nunca a aprovação.

Quem fechar o Flow antes dos documentos não perde nada. Pelo LOGIN, a lista de status mostra "Documentos inscrição: Pendentes [Verificar]" e o botão volta para as mesmas telas (seção 5).

---

## 3. Nota do ENEM: notas na tela do curso (igual ao site)

- **Campos da `INSC_CURSO_ENEM`:**
  - Curso\* e Turno\*, com o mesmo `buscar_turnos` da INSC_CURSO
  - Número de inscrição do ENEM\*: só dígitos, de 12 a 15
  - Ano de realização do ENEM\*: lista de 2026 a 2010 (`enemYears`)
  - As 5 notas\*: natureza, humanas, matemática, linguagens e redação, com a ajuda "Use ponto (.) para decimais. Máximo 1000."
- **Validação no Run**, com as mensagens do site: "Número de inscrição do ENEM é no mínimo 12 dígitos." / "… no máximo 15 dígitos." / "A nota máxima permitida é 1000."
- **Média:** o Flow não calcula na hora, porque o WhatsApp não tem campo calculado. O Run calcula (`enemAverage`), envia como `"628.10"`, como o site, e mostra "Média das notas do ENEM: 628,10" no topo da `INSC_QUASE_LA`.
- O worker já envia o curso junto com as notas (`etapa1-fila.js:546–549`). **O envio ao Rubeus não muda.** Muda só a tela onde as notas chegam: o worker passa a ter as notas no passo `curso`, sem esperar pela última tela.
- Os campos do ENEM que hoje estão escondidos na `INSC_QUASE_LA` ficam onde estão, sem uso (veja a sugestão V3).

---

## 4. O que o Run faz em segundo plano

### 4.1 Firestore (registro da etapa 1, `inscricoesFila`)
- `blocos.documentos_inscricao = { arquivos: { "<código>": <mídia criptografada do WhatsApp> }, completo }`. É gravado a cada tela, como o `gravarDocumento` da matrícula.
- O último documento marca `completo` e agenda o worker.
- Nada de arquivo no Firestore: guarda só a referência da mídia, e o worker baixa na hora de enviar.

### 4.2 Worker da etapa 1 (só para os 3 processos)
- **Passos de hoje:** inicio → basicos → turnos → curso → final → **fim**.
- **Novo passo depois de `fim`: `docs_inscricao`**
  1. Espera os documentos (`completo`). Se ainda não chegaram, o worker para e é agendado de novo quando chegarem.
  2. Calma de 60 s depois do Concluir, ajustável por variável. Como na matrícula, dá tempo ao RM de sincronizar.
  3. `portalSite.entrar(cpf, nascimento)` → `inscricao()` → acha a etapa `/document.*inscri/` e lê o **passo pelo `cta_link`**, sem fixar 300696/300681/300711.
  4. `passoBruto` → `lerPassoDocumentos`: confere os códigos do passo com os recebidos. Um código que não está no passo vira log de atenção e não é enviado.
  5. Baixa as mídias, faz **um** `button-click` multipart com todos os arquivos (`montarEnvio`, campo 38633, `file_0..n`) e relê o passo: espera `STATUSENVIO` "1".
  6. Grava `enviados_docs_inscricao`. **Repetição segura:** pula os códigos que já estão com status 1 ou 3.
- O formato é idêntico ao validado no Vestibular (16/11, Bárbara) e nos testes do site (Rebeca, Rosa e Juan). Não precisa de código novo de envio, só da chamada.

### 4.3 Vigia (mesma máquina da redação)
- Depois do envio, liga `inscricao_vigia` com `agendarVigia`, `travarVigia` e `vigia_proxima`, os mesmos de hoje.
- Intervalos: a cada 10 min nas primeiras 2 h, depois de hora em hora, por até 15 dias.

| O portal mostra | Ação |
|---|---|
| Docs "Em análise" e/ou notas "Validando" | aguarda |
| Docs de volta a "Pendentes" com Verificar (recusado, `STATUSENVIO` 2) | aviso: "Um documento foi recusado. Envie de novo pelo botão abaixo." |
| **ENEM, 38623 = 3** (desclassificado) | aviso com o texto do site ("não foi dessa vez… Desclassificado por insuficiência de nota") e o botão leva ao início (nova inscrição); o vigia para |
| ENEM aprovado (4–8) ou aparece a próxima etapa (ex.: "Seleção resp. financeiro: Pendente") | aviso: "Parabéns, você foi aprovado(a)! Continue sua matrícula pelo botão abaixo."; o vigia para |

- Os avisos usam o template já aprovado **`unibalsas_atualizacao_processo`**. **Não precisa de template novo.**
- Pela decisão C7, o botão abre a página 1, que tem o LOGIN.

### 4.4 Status pronto para o LOGIN
- No envio dos documentos e a cada conferência, o worker e o vigia gravam o status lido (`ultimo_status`, como hoje) no registro da matrícula (`matriculaFila`, `hash('matr:'+applyment_id)`), com login e nascimento criptografados.
- Assim o primeiro LOGIN já encontra o status salvo e não mostra "Buscando…".

---

## 5. LOGIN (etapa 2): ajustes para reconhecer as etapas novas

O status e a lista continuam iguais. Mudam 3 pontos, todos por **título da etapa**:

| Ponto | Hoje | Depois |
|---|---|---|
| Tocar em "Documentos inscrição: Pendentes [Verificar]" (`abrir_etapa` / `proximaTela`) | `/document/` → telas da **matrícula** (MATR_DOC_*) ou resp. financeiro: **errado** | `/document.*inscri/` → abre `INSC_DOC_1` pelo módulo da etapa 1, com um gancho igual ao `entrarNaProva`. Se houver recusa, abre só os recusados |
| "Checando as notas: Validando" | sem `cta_text` → só status | igual (nada a fazer) |
| `religarVigias` | a linha `/document/` (inscrição) faria ligar o vigia do **contrato** | ignora `/inscri/` na regra da matrícula e liga o `inscricao_vigia` |
| Worker da etapa 2 | `/document/` confunde inscrição com matrícula | ignora `/inscri/` |

Depois da aprovação, a etapa 2 desses processos segue a jornada genérica que já existe: resp. financeiro → pré-matrícula → docs de matrícula → contrato → pagamento. O Caleb, a Laura e o Matheus já passaram por ela.

---

## 6. Proteção do Vestibular

- **As telas do Vestibular não mudam:**
  - Nenhuma tela existente é alterada.
  - `INSC_CONCLUIDA`, `INSC_QUASE_LA` e `INSC_FIM` são reaproveitadas como estão.
  - A diferença fica no **Run**: a resposta depende do processo.
- **Toda lógica nova é condicionada** a `temDocsInscricao(processo)` (kind `registration` ou `enem`). Para `kind: "exam"` (Vestibular), cada ramo devolve exatamente o que devolve hoje.
- **Código compartilhado que muda:** só os 3 pontos da seção 5. Neles, a regra nova só vale para títulos com "inscri". O Vestibular não tem etapa "Documentos inscrição".
- **Testes de regressão antes de publicar:**
  - Os 172+ testes atuais.
  - Testes novos que fixam a jornada do Vestibular: Concluir → INSC_CONCLUIDA → INSC_PORTAL → prova; login → MATR_STATUS; docs de matrícula.
  - Testes dos 3 processos.
- **Um único JSON na WABA.** As telas novas aumentam o JSON, então é preciso colar e validar no editor da Meta antes de publicar. O Vestibular continua pelas mesmas telas.
- **Versão:** 2.13.0. A publicação só acontece com "publicar".

---

## 7. Sugestões de melhoria que tocam o Vestibular (preciso do seu OK)

| # | Sugestão | Por quê | Risco |
|---|---|---|---|
| **V1** | Salvar o status do portal também no fim da etapa 1 do Vestibular e no vigia da redação (como na seção 4.4) | O portal levou 6,7 s e o limite do login é 6,5 s. Hoje o login costuma cair em "Buscando… Atualizar". Com o status salvo, abre na hora. | Baixo: só grava um campo a mais |
| **V2** | Subir o limite dos documentos de 740 KB para 5 MB, igual ao site | Os 740 KB vinham da API antiga (corpo de 1 MiB). Hoje os documentos vão pelo caminho do site (multipart), que aceita 5 MB. Uma foto de celular passa fácil de 740 KB. | Médio: conferir o download da mídia e a memória do Cloud Run com arquivo de 5 MB antes |
| **V3** | Tirar da `INSC_QUASE_LA` os campos do ENEM que ficam escondidos | Limpeza: deixa o JSON menor. | Baixo, mas mexe numa tela do Vestibular. Pode ficar para depois. |

---

## 8. Ainda em aberto (não bloqueiam a implementação)

- Como fica o portal quando um documento é recusado (`STATUSENVIO` 2) e se o reenvio usa o mesmo botão. É provável, mas não foi testado.
- O nome da etapa que aparece depois da aprovação no Portador e no ENEM. Pelo Caleb, deve ser "Seleção resp. financeiro".
- O texto que "Checando as notas" mostra depois da validação.
- O vigia trata por título e status. Os candidatos de teste (Rebeca 14320114, Rosa 14320168, Juan 14320206) ficam para conferir quando a equipe agir.
- O rótulo dinâmico do Footer e o `min-uploaded-documents` 0 do DocumentPicker precisam ser validados no editor da Meta.

## 9. Ordem de implementação proposta

1. `processes.js`: `temDocsInscricao` e a lista de documentos por processo.
2. Flow: telas `INSC_CURSO_ENEM`, `INSC_STATUS` e `INSC_DOC_1..3` (`flows/gerar-etapa1.mjs`).
3. `etapa1-fila.js`: notas na tela do curso, a sequência depois do Concluir, `gravarDocumentoInscricao`, o passo `docs_inscricao` e o registro na `matriculaFila`.
4. `etapa2-matricula.js`: os 3 pontos da seção 5 e o `inscricao_vigia`.
5. Testes (regressão do Vestibular + os 3 processos) → validar o JSON no editor da Meta → teste no celular com um candidato fictício novo.
