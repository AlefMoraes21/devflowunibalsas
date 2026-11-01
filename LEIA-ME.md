# ENEM 1.3.0 — até a confirmação da inscrição

Esta versão parte do código 1.2.1 conferido no GitHub AlefMoraes21/devflowunibalsas e do flow-waba.json atual do repositório. Não publica mudanças no Git nem no Cloud Run automaticamente.

## O que muda

- ENEM (processo 20386) usa uma tela exclusiva CURSO_ENEM. As telas anteriores permanecem idênticas ao JSON do GitHub, incluindo privacidade, vestibular, redação e confirmação. DADOS_BASICOS recebe uma nova saída de roteamento para CURSO_ENEM.
- Curso e notas seguem para Estamos quase lá e depois para Obrigado pelo seu cadastro. O desvio anterior para DOCUMENTOS_ENEM não é usado pelo caminho novo.
- Nenhum upload ou etapa do portal é implementado nesta entrega. A confirmação da inscrição não significa aprovação das notas nem recebimento dos documentos.
- Média digitável, opcional. Calcular média consulta apenas o endpoint do Flow, sem chamar o Rubeus. Preenche a média com duas casas, aceita vírgula ou ponto e preserva os demais campos. Se ficar vazia, é calculada ao continuar. Se uma média digitada divergir da média das cinco notas, o usuário recebe a orientação para corrigi-la antes de enviar.
- Não foi introduzido um gatilho automático em TextInput: o cálculo é disparado pelo link Calcular média ou pelo botão Continuar. Não há atualização automática a cada tecla.
- Anos vêm das opções devolvidas pelo formulário; a lista de contingência inclui 2026, conforme a captura fornecida.
- O envio do curso/notas do ENEM é durável e assíncrono, como a conclusão da inscrição. A seleção de curso e o cálculo continuam leves.
- Se o envio das notas foi confirmado, mas a leitura do formulário final falhou, Retomar inscrição consulta o próximo passo sem reenviar /submit. O destino e token ficam no registro criptografado da tarefa e no estado autenticado. Não há fallback para o botão final do vestibular.
- O envio da inscrição só mostra sucesso após Rubeus success=true e um identificador de inscrição. Timeout sem confirmação não é convertido em sucesso.

## Preservação do vestibular

A avaliação, o vínculo da prova, os cookies e a entrega da redação não foram alterados. api/avaliacao.js, cloud-store.js, diagnostics.js, prompt-text.js, proof-binding.js e prova-route.js são idênticos à base conferida. jobs.js só acrescenta as ações da nova tela ENEM; o avanço da tela CURSO_INTERESSE continua síncrono como antes.

## Arquivos a atualizar

Servidor: api/flow.js, api/jobs.js, novo api/enem.js e package.json. O ZIP completo também contém os módulos e arquivos de execução anteriores, necessários para implantação por fonte.
Meta: substitua o JSON pelo flow-waba.json deste pacote. O servidor e o JSON precisam ser atualizados antes do teste. Reabra o Flow para começar uma sessão nova; sessões ENEM antigas não são migradas.
GitHub: sincronize os arquivos alterados para que um deploy automático posterior não reverta a atualização. Pode versionar também JSON, testes e documentação. Este pacote não foi enviado ao GitHub pela assistência.

## Implantação

Envie cloud-run-flow-1.3.0.zip ao Cloud Shell e execute em uma aba livre (não na aba de logs tail):

```bash
flow_dir=$(mktemp -d /tmp/unibalsas-deploy-XXXXXX)
unzip "$HOME/cloud-run-flow-1.3.0.zip" -d "$flow_dir" &&
gcloud run deploy devflowunibalsas-git \
  --project=talks-servidor \
  --region=southamerica-east1 \
  --source="$flow_dir"
```

Fila, banco e variáveis existentes continuam necessários. Não é necessário executar implantar.sh para criar infraestrutura outra vez.

```bash
curl -sS https://devflowunibalsas-git-83531798597.southamerica-east1.run.app/api/flow
```

Versão esperada: unibalsas-cloudrun-enem-1.3.0.

## Validação realizada

65 testes locais passaram: regressões da prova, notas decimais/zero/mil, validação de média, ano 2026, caminho ENEM com contratos sanitizados dos passos 300708 e 300709, repetição de clique/tarefa sem novo submit e retomada somente por leitura após falha no formulário final. O teste de preservação compara o hash de cada tela anterior com o JSON efetivamente lido do GitHub.

As chamadas Google/Rubeus dos testes são simuladas. Nenhuma inscrição foi criada durante esta alteração. A importação/compilação do JSON na Meta e o teste integrado real ainda precisam ser feitos. Consultas atuais à documentação Meta retornaram HTTP 429; foram usados os conteúdos oficiais capturados anteriormente para os componentes e ações já conhecidos. Não há promessa de cálculo automático por digitação.

## Teste integrado sugerido

1. Reabrir um Flow novo com Nota do ENEM - 2027/1.
2. Preencher dados básicos e selecionar curso/turno.
3. Preencher inscrição, ano e cinco notas; testar Calcular média e editar uma nota depois para conferir validação.
4. Continuar, consultar o andamento se necessário e preencher Estamos quase lá.
5. Concluir e conferir o protocolo no Flow e a inscrição no CRM.
6. O portal pode continuar mostrando Checando as notas / Validando e Documentos inscrição / Pendentes. Esta versão não conclui essas etapas posteriores.

## Logs

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="devflowunibalsas-git" AND (jsonPayload.event="enem_course_received" OR jsonPayload.event="enem_registration" OR jsonPayload.event="flow_job" OR jsonPayload.event="rubeus_error" OR jsonPayload.event="flow_error" OR jsonPayload.event="flow_worker_error")' --project=talks-servidor --freshness=24h --limit=80 --order=desc --format=json
```

## Fontes e contratos

- API de formulários e submissão: https://docs.rubeus.com.br/api_im/metodosdeinscricao/
- Componentes Meta: https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/components
- JSON e ações Meta: https://developers.facebook.com/docs/whatsapp/flows/reference/flowjson/
- Captura anterior do site: passos 300707 (dados básicos), 300708 (curso/notas), 300709 (finalização) e telas fornecidas pelo usuário nesta revisão. Os campos e botões da integração continuam sendo obtidos do formulário oficial.
