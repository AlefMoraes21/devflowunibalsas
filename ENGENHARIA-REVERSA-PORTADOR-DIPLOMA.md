# Engenharia reversa — Portador de Diploma 2027/1 (20384): Etapa 1

Mapeada em 17/11/2026 pelo site, com dados fictícios do 4devs fornecidos pelo usuário: **Rosa Helena P. Rodrigues**, Enfermagem – Noturno.
- **applyment 14320168**, person_id 10163911, contato CRM 607802, CODUSUARIOPS 20171.
- Corpos e respostas capturados no navegador. Tokens, sessões e CPF não foram registrados.

**Etapa 1 do Flow = Inscrição + Documentos de inscrição.** Ela termina em "Documentos inscrição: **Em análise**". Daí em diante o candidato espera a aprovação da equipe. É o mesmo ponto de pausa da Transferência ([ENGENHARIA-REVERSA-TRANSFERENCIA-DOCUMENTOS.md](ENGENHARIA-REVERSA-TRANSFERENCIA-DOCUMENTOS.md)) e equivale à espera pela correção da redação no Vestibular.

## 1. Rotas e endpoints, na ordem

| # | Chamada | Tempo | Para quê |
|---|---|---|---|
| 1 | `start-applyment` (process_id 20384) | 0,1 s | devolve o 1º passo **300677** (stage **261013**) |
| 2 | `getApplymentDataByStep/300677` | 0,1 s | conteúdo do passo; `settings/selective-process` → 20384; `stage-steps/` → 300677, 300678, 300679 |
| 3 | `button-click` (JSON) — Dados básicos | 1,5 s | cria a inscrição (devolve `applyment_id`, `person_id`) |
| 4 | `button-click` (JSON) — Curso | 1,9 s | grava curso e turno |
| 5 | `button-click` (JSON) — Concluir | — | `place_type_id 3`, link `seletivo.unibalsas.edu.br/obrigado-3` |
| 6 | Portal `/presencial/portal-inscrito`: `person-applyment` + `register-portal-data` | **6,0 s** | situação por etapa |
| 7 | `getApplymentDataByStep/300681` | 1,0 s | documentos de inscrição |
| 8 | `button-click` (**multipart**) — Enviar | **9,7 s** | os 3 arquivos em uma chamada |

São os mesmos endpoints, o mesmo motor e o mesmo formato do Vestibular e da Transferência. Mudam os IDs abaixo.

## 2. Inscrição (stage 261013)

| Passo | Tela | Botão / relacionado | Campos enviados |
|---|---|---|---|
| 300677 | Dados básicos | **3940490** / 174874 | 38544 nome, 38545 e-mail, 38546 celular (só dígitos), **38548 IDPS = "224"**, 38564 gênero `F`, 38565 = 2, 38566 nascimento `AAAA-MM-DD`, 38606 nome social (false), 38679 = true, 38707 = "1", 38708 = "4" |
| 300678 | Curso de interesse | **3940500** / 174875 | 38627 curso `1-480` (Enfermagem), 38547 turno `"6"`, **38550 CODPOLO `"01"`**, 38552 CODOFERTA **`1-224-420`**, 38553 `"420"`, 38610/38611/38612 = `"1"` |
| 300679 | Estamos quase lá → **Concluir** | (form-data; ver abaixo) | 38567 CPF, 38780 nacionalidade (Brasileira), 251544 ensino médio (Sim), 38575 deficiência (Não), 319427 origem (consulta `RB.PS.IM.043`, mesmas 10 opções) |

- **IDPS acadêmico do Portador = 224.** Confirmado em 38548, no CODOFERTA `1-224-…` e no `identifier` "1-224" do `person-applyment`. Bate com `api/processes.js` (`"20384":{kind:"registration",academicId:"224"}`).
- Cursos: consulta `RB.PS.IM.006`, as mesmas 11 ofertas da Transferência. O turno vem preenchido quando o curso tem um só.
- **Resposta do Concluir.** Nova em relação à Transferência, onde esse corpo foi perdido. Vem com `fields_updated`, que mostra o que o RM devolve:
  - 38543 CODINSCRICAO-base `1-224-21`, 38609 `21`
  - 38614 `325`, 38621 "Processo Seletivo 2027.1 - Portador de Diploma"
  - 38673 "ENFERMAGEM", 38626 "NOTURNO-", 38551 "Presencial", 38735 "CAMPUS - UNIBALSAS", 38638 "CAMPUS CENTRAL", 38736 `635`
  - 38629 primeiro nome, 38608/38782 CODUSUARIOPS `20171`
  - 38617 "MA", 38616 "01400", 38742 "rubeus1"
  - flags 38678 T, 38584–38589 F, 38739 F, 38743 S, 38744 F, 38768 T
- O CPF desta candidata **não existia** no RM (38608 começou em 0). Na Transferência existia, e o RM misturou dados antigos.

## 3. Portal após a inscrição

| Momento | Etapas (`register-portal-data`) |
|---|---|
| Logo após concluir | 261013 Inscrição **Concluída** (link `presencial/feedback/920212`) · 261015 Documentos inscrição **Pendentes** + **Verificar** (`presencial/passo/300681`) |
| Após enviar os 3 | 261013 Concluída · 261015 **Em análise**, `cta_text`/`cta_link` nulos (sem botão) |

Nenhuma etapa seguinte aparece enquanto os documentos estão em análise.

## 4. Documentos de inscrição (passo 300681, stage 261015)

- O componente `upload` **3940539** traz o `upload_content` da consulta `RB.PS.IM.012` (parâmetro CODINSCRICAO = campo 38543):
  - `10` DIPLOMA DE GRADUAÇÃO, `OBRIGATORIO` 1
  - `17` HISTÓRICO DA GRADUAÇÃO, 0
  - `26` CERTIDÃO DE CONCLUSÃO - GRADUAÇÃO, 0
- Campos de gravação:
  - tipo/lista = **38633**
  - base64 = 38631
  - status = 38632
  - nome = 38634
- Regras do upload: limite de 5 MB (`upload_size_type_id` 4); tipos 1, 2, 3 e 7; `upload_multiple_files` 1; `block_attaching_reject_files` 0.
- Botões:
  - **3940542 "Enviar"** (`store_data` 1, relacionado **174882**, o mesmo da Transferência)
  - 3940541 "Portal do candidato" (relacionado 174878)
- **Envio (`button-click` multipart):**
  - Parâmetros: `button_id 3940542`, `related_component_id 174882`, `stage_id 261015`, `last_place_id 300681`, `last_place_type_id 1`, `selective_process_id 20384`, `contact_id_crm`, `session_id`, `substitute_id`, `token`, `hostClient`, `domainParams presencial`, `formio_comp_id`, `rbParams "null"`.
  - Arquivos: `file_0`, `file_1` e `file_2`.
  - `data` com o campo 38633 (componente 3940539, `type:"upload"`):
    `[{CODIGO:"10",title:"DIPLOMA DE GRADUAÇÃO",STATUSENVIO:null,PATHARQUIVO:null,CHAVERM:null,ADICIONAL:null,ADICIONAL2:null,files:[{}],value:["file_0"]}, {CODIGO:"17",…,value:["file_1"]}, {CODIGO:"26",…,value:["file_2"]}]`
  - Mais os conteúdos 3940535, 3940537 e 3940538, com valor vazio.
- Resposta em **9,7 s**: `{success:true, place_id:300681, place_type_id:5, stage_id:261015, redirect_id:54154, applyment_id:14320168}`. O site volta ao portal.
- Ao reler o passo, os 3 itens vêm com **`STATUSENVIO` "1"** (em análise).
- O formato é **idêntico** ao de `montarEnvio` / `lerPassoDocumentos` em `api/portal-site.js`. O leitor encontra o componente `upload`, o campo 38633 e o botão com `store_data` 1 sem mudança nenhuma.

## 5. Comparação Portador × Transferência × Vestibular

| Item | Vestibular (20383) | Transferência (20385) | **Portador (20384)** |
|---|---|---|---|
| IDPS (38548) | — | 225 | **224** |
| Passos da inscrição | 3 | 300692 / 300693 / 300694 | **300677 / 300678 / 300679** |
| Botões da inscrição | — | 3940623 / 3940633 | **3940490 / 3940500** |
| CODPOLO 38550 | não envia | "01" | "01" |
| Etapa após a inscrição | Avaliação online (redação) | Documentos inscrição (300696) | **Documentos inscrição (300681)** |
| Documentos | — | 28\* Histórico acadêmico, 29 Planos de ensino, 27 Declaração de vínculo | **10\* Diploma de graduação, 17 Histórico da graduação, 26 Certidão de conclusão - graduação** |
| Upload / Enviar | — | 3940672 / 3940675 | **3940539 / 3940542** |
| Pausa humana | correção da redação | docs "Em análise" | docs "Em análise" |

## 6. O que muda no Flow/Run (o mesmo plano da Transferência, seção E)

O Run atual (`etapa1-fila.js:565`) fecha a etapa 1 do Portador logo depois da inscrição confirmada (`sucesso`, `dados_recebidos`). Para ficar igual ao site:

1. **Etapa 1 do Portador:** depois de "Concluir", seguir pelas telas `INSC_CONCLUIDA` (Obrigado) → `INSC_PORTAL` ("Inscrição: Concluída", "Documentos inscrição: Pendentes" + Verificar) → 3 telas de documento (**Diploma de graduação\***, Histórico da graduação, Certidão de conclusão – graduação) → fim: "Recebemos seus documentos. A análise ocorre em até 48 horas úteis." e **fecha a etapa 1**.
2. **Firestore primeiro:** os arquivos vão para `blocos.documentos_inscricao` e o Flow responde de imediato.
3. **Worker:** `entrar` → passo lido do `cta_link` de "Documentos inscrição" → **um** `button-click` com `montarEnvio` → pula `STATUSENVIO` 1 ou 3.
4. **Vigia:** acompanha o portal enquanto estiver "Em análise". Quando liberar a próxima etapa, avisa pelo Blip (template `unibalsas_atualizacao_processo`) e o candidato entra na etapa 2.
5. **Uma solução para os três** (Transferência, Portador e ENEM): a lista de documentos e os IDs vêm sempre do passo lido (`lerPassoDocumentos`), sem tabela fixa por processo. Só os títulos das telas vêm do `upload_content`. Condicionar por `isDirectRegistration(processo)`, sem mexer no Vestibular.
6. **Etapa 2:** `proximaTela` e o worker precisam separar "Documentos inscrição" (`/inscri/`) de "Documentos matrícula" (`/matric/`). Hoje "Documentos inscrição: Pendentes" cai em MATR_RESPONSAVEL.

## 7. Telas e textos do site, na ordem (copiados em 17/11/2026)

Os textos são **idênticos** aos da Transferência (seção F daquele documento). Muda só o seguinte:
- Barra lateral: "Portador de Diploma - 2027/1 · Inscrição", com os passos Dados básicos / Curso de interesse / Estamos quase lá.
- **1. Escolha do processo:** opção **"Portador de Diploma - 2027/1"** → "Iniciar inscrição".
- **2. Dados básicos (300677):** "Olá! Para começar, preencha alguns dados básicos sobre você:". Campos Nome completo\*, ☐ Possuo nome social, E-mail\*, Data de nascimento\*, Celular\* ("Para facilitar o nosso contato, informe o seu WhatsApp, de preferência."), Gênero\* Masculino/Feminino e o aceite LGPD. Botões VOLTAR | AVANÇAR.
- **3. Curso de interesse (300678):** "Conte-nos mais detalhes sobre o curso de seu interesse!". Curso\* e Turno\*, com os 11 cursos: Agronomia, Análise e Desenvolvimento de Sistemas, Biomedicina, Ciências Contábeis, Direito, Enfermagem, Estética e Cosmética, Medicina Veterinária, Odontologia, Produção Publicitária e Psicologia.
- **4. Estamos quase lá (300679):** "Estamos quase lá!" / "Complete as suas informações para concluir a sua inscrição.". Campos CPF\*, Nacionalidade\* (padrão Brasileira), "Você já concluiu o ensino médio?"\*, "Possui alguma deficiência?"\* e "Como você ficou sabendo sobre este processo seletivo?"\* com as 10 opções. Botões VOLTAR | **CONCLUIR**.
- **5. Obrigado** (`seletivo.unibalsas.edu.br/obrigado-3`): "Obrigado pelo seu cadastro!" / "Nossos consultores entrarão em contato com você em breve." Botão "Acessar Portal do Candidato [Presencial]", que leva a `/presencial/login`.
- **6. Portal:** "Processos abertos: Portador de Diploma - 2027/1 - ENFERMAGEM - NOTURNO-". Status: Inscrição **Concluída** · Documentos inscrição **Pendentes** + **Verificar**.
- **7. Feedback da inscrição (920212):** "Parabéns! Sua inscrição foi concluída com sucesso, acompanhe o andamento deste processo no portal do candidato." Curso ENFERMAGEM - NOTURNO- · Presencial · UNIBALSAS EDUCACIONAL LTDA · NOTURNO-. Botão PORTAL DO CANDIDATO.
- **8. Documentos de inscrição (300681):** "Envio de arquivos", com as mesmas 6 regras numeradas da Transferência. Itens:
  - **DIPLOMA DE GRADUAÇÃO \***
  - HISTÓRICO DA GRADUAÇÃO
  - CERTIDÃO DE CONCLUSÃO - GRADUAÇÃO

  Cada item tem ANEXAR; depois de anexar aparece o nome do arquivo com "x" e surge o botão ENVIAR. Botões PORTAL DO CANDIDATO | ENVIAR.
- **9. Depois do envio:** o portal mostra "Documentos inscrição: **Em análise**", sem botão. **Fim da etapa 1. Aguardando a aprovação humana.**

## Ainda em aberto

- Quanto tempo a equipe leva para tirar de "Em análise" e qual etapa aparece em seguida no Portador. Esperado: "Seleção resp. financeiro", como no Matheus; a inscrição 14320168 fica para acompanhar.
- O reenvio de documento recusado (`STATUSENVIO` 2) não foi testado.

## Rastros deste teste

Inscrição 14320168 (Enfermagem Noturno), com 3 PDFs de teste de 416 B ("DOCUMENTO DE TESTE - NAO VALIDO"), anexados por script. Nenhum pagamento. Nenhum código alterado.
