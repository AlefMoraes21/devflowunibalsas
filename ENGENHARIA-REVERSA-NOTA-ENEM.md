# Engenharia reversa — Nota do ENEM 2027/1 (20386): Etapa 1

Mapeada em 17/11/2026 pelo site, com dados fictícios do 4devs fornecidos pelo usuário: **Juan Luiz L. da Costa**, Psicologia – Noturno.
- Inscrição: **applyment 14320206**, person_id 10163943, contato CRM 607807, CODUSUARIOPS 20172.
- ENEM de teste: inscrição `999999999999` (fictícia), ano 2025.
- Notas: natureza 600.5, humanas 620, matemática 580, linguagens 640, redação 700. Média 628.10.
- Tokens, sessões e CPF não foram registrados.

**Etapa 1 do Flow = Inscrição (com as notas) + Documentos de inscrição (boletim).** Ela termina com "Checando as notas: **Validando**" e "Documentos inscrição: **Em análise**", e espera a equipe validar. É o mesmo ponto de pausa da Transferência e do Portador. No ENEM há uma etapa a mais, a do resultado: aprovado ou desclassificado (seção 4).

## 1. Rotas e endpoints, na ordem

| # | Chamada | Tempo | Para quê |
|---|---|---|---|
| 1 | `start-applyment` (process_id 20386) | 0,1 s | 1º passo **300707** (stage **261039**) |
| 2 | `getApplymentDataByStep/300707`, `settings/selective-process` → 20386, `stage-steps/` → 300707, 300708, 300709 | 0,1 s | conteúdo |
| 3 | `button-click` (JSON) Dados básicos | 1,7 s | cria a inscrição |
| 4 | `button-click` (JSON) Curso **+ notas do ENEM** | 2,1 s | curso, turno e notas |
| 5 | `button-click` Concluir | ~15 s até o redirecionamento | `place_type_id 3` → `seletivo.unibalsas.edu.br/obrigado-3` |
| 6 | Portal: `person-applyment` + `register-portal-data` | **6,3 s** | 3 etapas |
| 7 | `getApplymentDataByStep/300711` | ~1 s | documentos de inscrição |
| 8 | `button-click` (**multipart**) Enviar | **4,9 s** | 1 arquivo |

O motor e o formato são os mesmos do Vestibular, da Transferência e do Portador.

## 2. Inscrição (stage 261039)

| Passo | Tela | Botão / relacionado | Campos enviados |
|---|---|---|---|
| 300707 | Dados básicos | **3940757** / 174874 | 38544 nome, 38545 e-mail, 38546 celular, **38548 IDPS = "226"**, 38564 gênero `M`, **38565 = 1** (masculino; feminino é 2), 38566 `AAAA-MM-DD`, 38606 false, 38679 true, 38707 "1", 38708 "4" |
| 300708 | Curso de interesse **+ ENEM** | **3940768** / 174875 | 38627 curso `1-240` (Psicologia), 38547 turno `"2"`, 38550 CODPOLO `"01"`, 38552 CODOFERTA **`1-226-354`**, 38553 `"354"`, 38610/38611/38612 `"1"`; **ENEM:** 38556 nº de inscrição `"999999999999"`, 38557 ano `"2025"`, 38563 natureza `600.5`, 38562 humanas `620`, 38561 matemática `580`, 38560 linguagens `640`, 38559 redação `700` (as notas vão como **número**), **38558 média `"628.10"` (texto)** |
| 300709 | Estamos quase lá → **Concluir** | **3940774** / 174876 | 38567 CPF, 38575 `"F"` (deficiência: Não), 38609 `""`, 38780 `"10"` (Brasileira), 251544 `"Sim"`, 319427 `"05"` (Indicação de amigos ou familiares) |

**Regras dos campos do ENEM** (do `form_build` do passo 300708):
- **Número de inscrição:** obrigatório, só dígitos, de **12 a 15**. Mensagens: "Número de inscrição do ENEM é no mínimo 12 dígitos." e "… no máximo 15 dígitos."
- **Ano de realização:** select com os anos de **2026 a 2010**, obrigatório.
- **5 notas:** obrigatórias, 1 casa decimal, placeholder `000.0`, máximo 1000 ("A nota máxima permitida é 1000."). A ajuda de cada uma diz: "Usar ponto "." como separador de decimais."
- **Média:** campo **bloqueado**, calculado pelo site como média simples das 5 (classe `mediaenem`). É enviado com 2 casas decimais ("628.10").

**Resposta do Concluir** (`fields_updated`):
- **As notas voltam para os campos do RM**, com vírgula: 38693 = 620 (humanas), 38694 = 640 (linguagens), 38695 = 580 (matemática), 38696 = "600,5" (natureza), 38697 = "628,10" (média), 38698 = 700 (redação).
- 38543 `1-226-27`, 38614 `308`, 38621 "Processo Seletivo 2027.1 - ENEM", 38628 `3`.
- 38673 "PSICOLOGIA", 38626 "NOTURNO", 38736 `639`, 38737 `432`.
- 38629 primeiro nome, 38608/38782 CODUSUARIOPS `20172`.
- 38744 vem `T` no ENEM (`F` no Portador).
- O CPF era novo no RM.

## 3. Portal após a inscrição

| Momento | Etapas (`register-portal-data`) |
|---|---|
| Logo após concluir | 261039 Inscrição **Concluída** (`presencial/feedback/920306`) · **261049 Checando as notas: Validando** (`cta_link presencial/passo/300719`, sem botão) · 261041 Documentos inscrição **Pendentes** + **Verificar** (`presencial/passo/300711`) |
| Após enviar o boletim | Concluída · Checando as notas **Validando** · Documentos inscrição **Em análise**, sem botão |

## 4. "Checando as notas" (passo 300719, stage 261049): o resultado

- A tela não tem campos para o candidato. São 2 blocos de mensagem, e o que aparece depende do campo **38623 "Status da opção"**, que o RM grava. Hoje o valor é `0`, e o portal mostra "Validando".
- **38623 = 3 → Desclassificado** (container 3940864). Texto:
  > 😕 Prezado {primeiro nome}, não foi dessa vez... Suas notas não foram suficientes para você ser aprovado em nosso processo seletivo, mas não desista! Há outras formas de ingresso, só clicar no botão abaixo para realizar uma nova inscrição. Situação: Desclassificado por insuficiência de nota

  Botão **"Nova inscrição"** (3940869 / 174904). Também tem o botão "Portal do candidato" (3940868).
- **38623 entre 4 e 8 → Aprovado** (container 3940870; operadores 5 e 6 sobre os valores 4 e 8; a leitura "≥ 4 e ≤ 8" é **inferida**). Texto:
  > 😁🎉 Parabéns {primeiro nome}, você foi aprovado em nosso processo seletivo! Agora, você pode dar continuidade a sua pré-matrícula clicando no botão abaixo.

  Botão "Portal do candidato" (3940874 / 174907).
- `{primeiro nome}` é o campo 38629, que o RM preenche com o primeiro nome em maiúsculas (ex.: "JUAN").

## 5. Documentos de inscrição (passo 300711, stage 261041)

- Componente `upload` **3940807**, consulta `RB.PS.IM.012`. Um único documento: **`25` BOLETIM NOTA ENEM**, `OBRIGATORIO` 1.
- Campos de gravação: 38633 (lista), 38631 (base64), 38632 (status) e 38634 (nome). Limite de 5 MB.
- Botões: **3940810 "Enviar"** (`store_data` 1, relacionado **174882**) e 3940809 "Portal do candidato" (174878).
- **Envio (multipart):**
  - Parâmetros: `button_id 3940810`, `related_component_id 174882`, `stage_id 261041`, `last_place_id 300711`, `last_place_type_id 1`, `selective_process_id 20386`, mais os de sessão de sempre.
  - Arquivo: `file_0`.
  - `data` com o campo 38633: `[{CODIGO:"25",title:"BOLETIM NOTA ENEM",STATUSENVIO:null,…,files:[{}],value:["file_0"]}]`, mais os conteúdos 3940803, 3940805 e 3940806.
- Resposta em **4,9 s**: `{success:true, place_id:300711, place_type_id:5, stage_id:261041, redirect_id:54154, applyment_id:14320206}`.
- Ao reler o passo, o documento vem com **`STATUSENVIO` "1"**.
- O formato é idêntico ao de `montarEnvio` / `lerPassoDocumentos` (`api/portal-site.js`).

## 6. Comparação dos 4 processos

| Item | Vestibular 20383 | Transferência 20385 | Portador 20384 | **ENEM 20386** |
|---|---|---|---|---|
| IDPS (38548) | — | 225 | 224 | **226** |
| Passos da inscrição | — | 300692–94 | 300677–79 | **300707–09** |
| Botões (dados / curso / concluir) | — | 3940623 / 3940633 / — | 3940490 / 3940500 / — | **3940757 / 3940768 / 3940774** |
| Campos extras no curso | — | — | — | **nº de inscrição, ano, 5 notas e média** |
| Etapas após a inscrição | Avaliação online | Docs inscrição 300696 | Docs inscrição 300681 | **Checando as notas 300719 + Docs inscrição 300711** |
| Documentos | — | 28\*, 29, 27 | 10\*, 17, 26 | **25\* Boletim nota ENEM** |
| Upload / Enviar | — | 3940672 / 3940675 | 3940539 / 3940542 | **3940807 / 3940810** |
| Pausa humana | correção da redação | docs em análise | docs em análise | **notas validando + docs em análise** |

## 7. O que muda no Flow/Run

1. **Notas no lugar certo.** No site, as notas ficam no passo **Curso de interesse** (300708), logo abaixo de curso e turno. O Flow atual (`etapa1-fila.js`, `INSC_QUASE_LA` + `ENEM_CAMPOS`) as pede na **última** tela. Para ficar "igual ao site", passar o bloco de notas para a tela de curso quando `eh_nota_enem`. O worker já manda o curso junto com as notas (`etapa1-fila.js:546`), então o envio ao Rubeus não muda.
2. **Média.** No site ela é calculada e bloqueada. O Flow deve mostrá-la calculada (`enemAverage` já faz isso) e enviá-la com 2 casas decimais (`"628.10"`).
3. **Depois do Concluir:** o mesmo plano da Transferência e do Portador. São as telas Obrigado → Portal (Inscrição: Concluída · **Checando as notas: Validando** · Documentos inscrição: Pendentes + Verificar) → 1 tela de documento (**Boletim nota ENEM\***) → fim ("Recebemos seu boletim. A análise ocorre em até 48 horas úteis.") e **fecha a etapa 1**.
4. **Worker:** `entrar` → passo do `cta_link` de "Documentos inscrição" → um `button-click` (`montarEnvio`). É a mesma solução única para os processos de inscrição direta.
5. **Vigia do resultado**, como o da redação:
   - Ler "Checando as notas" no portal, ou o campo 38623 no `applicantData` do passo 300719.
   - **Aprovado (4–8):** aviso pelo Blip "Parabéns… aprovado", e o candidato entra na etapa 2 (pré-matrícula).
   - **Desclassificado (3):** aviso com o texto do site e a opção de nova inscrição.
   - É preciso confirmar no portal qual `complementary_text` aparece em cada caso.
6. **Etapa 2:** `proximaTela` deve reconhecer "Checando as notas" (só status, sem botão) e "Documentos inscrição" (separado de matrícula).

## 8. Telas e textos do site, na ordem (copiados em 17/11/2026)

Iguais aos da Transferência e do Portador, com estas diferenças:
- Barra lateral: "Nota do ENEM - 2027/1 · Inscrição", com os passos Dados básicos / Curso de interesse / Estamos quase lá.
- **1. Escolha do processo:** opção **"Nota do ENEM - 2027/1"** → "Iniciar inscrição".
- **2. Dados básicos (300707):** idêntico ("Olá! Para começar, preencha alguns dados básicos sobre você:", …).
- **3. Curso de interesse (300708):** "Conte-nos mais detalhes sobre o curso de seu interesse!". Campos, nesta ordem:
  - Curso\* e Turno\* (os 11 cursos)
  - **Número de inscrição do ENEM\*** e **Ano de realização do ENEM\***
  - **Nota de ciências da natureza do ENEM\*** ⓘ e **Nota de ciências humanas do ENEM\*** ⓘ
  - **Nota de matemática do ENEM\*** ⓘ e **Nota de linguagens do ENEM\*** ⓘ
  - **Nota da redação do ENEM\*** ⓘ e **Média de notas do ENEM\*** (bloqueado, calculado)
  - Ajuda ⓘ: "Usar ponto "." como separador de decimais."
  - Botões VOLTAR | AVANÇAR
- **4. Estamos quase lá (300709):** "Estamos quase lá!", com o subtítulo **"Complete com suas informações para concluir a sua inscrição."** (no ENEM tem "com"; na Transferência e no Portador é "Complete as suas informações…"). Campos e as 10 origens são iguais. Botões VOLTAR | CONCLUIR.
- **5. Obrigado:** a mesma página `obrigado-3`.
- **6. Portal:** "Processos abertos: Nota do ENEM - 2027/1 - PSICOLOGIA - NOTURNO". Status:
  - Inscrição **Concluída**
  - **Checando as notas: Validando**
  - Documentos inscrição **Pendentes** + **Verificar**
- **7. Documentos de inscrição (300711):** "Envio de arquivos" e as mesmas 6 regras. Um item: **BOLETIM NOTA ENEM \***, com ANEXAR → arquivo com "x" → ENVIAR. Botões PORTAL DO CANDIDATO | ENVIAR.
- **8. Depois do envio:** Inscrição Concluída · Checando as notas **Validando** · Documentos inscrição **Em análise**. **Fim da etapa 1. Aguardando a validação humana.**
- **9. Resultado (300719), quando a equipe validar:** as mensagens de aprovado e desclassificado da seção 4.

## Ainda em aberto

- O texto de status que o portal mostra em "Checando as notas" depois da validação (aprovado ou desclassificado) e a etapa que aparece em seguida. A inscrição 14320206 fica para acompanhar; com a inscrição ENEM fictícia, o esperado é desclassificação ou recusa do boletim.
- A leitura exata dos operadores 5 e 6 (inferida como ≥ e ≤).
- A página de feedback 920306 não foi aberta. Esperado: o mesmo "Parabéns! Sua inscrição foi concluída…" dos outros processos.

## Rastros deste teste

Inscrição 14320206 (Psicologia Noturno), com 1 PDF de teste de 416 B ("DOCUMENTO DE TESTE - NAO VALIDO"). Nenhum pagamento. Nenhum código alterado.
