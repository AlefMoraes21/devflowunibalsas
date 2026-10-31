# Flow 1.1.0 — operações lentas com acompanhamento na mesma tela

Esta versão muda a arquitetura da conclusão de inscrição, abertura da redação e entrega da redação. O objetivo é deixar o processamento remoto continuar sem manter o webhook da Meta esperando nem fechar o Flow.

## O que o candidato vê

Ao concluir a inscrição, QUASE_LA pode mostrar “Estamos concluindo sua inscrição e preparando sua próxima etapa”. Os campos ficam ocultos e o botão vira “Verificar andamento”. A consulta recupera o resultado da mesma operação; não submete novamente. Após confirmação, a resposta leva a TELA_ORIENTACAO_PROVA. Ao iniciar a redação, o mesmo comportamento ocorre na orientação até o resultado levar a TELA_REDACAO.

O endpoint espera brevemente pelo resultado; se a fila e o worker terminarem rápido, a próxima tela já é retornada. Se ainda estiver processando, o usuário consulta pelo botão. Os componentes usados não implementam um temporizador de atualização automática. Não há promessa de troca espontânea da tela depois que uma resposta já foi entregue.

## Mudança no servidor

- Cloud Tasks entrega a operação ao endpoint /internal/flow-worker. O corpo da tarefa contém apenas um identificador; a autenticação da aplicação usa assinatura HMAC derivada da chave privada do Flow.
- Firestore persiste requisição e resultado com criptografia adicional AES-GCM. Apenas o servidor acessa os documentos via OAuth da conta de serviço do Cloud Run; não há acesso do cliente ao banco.
- A criação da tarefa usa um nome determinístico. O registro da operação e a aquisição pelo worker usam criação exclusiva e precondição de versão. Repetições do mesmo clique e entregas duplicadas não executam novamente a mesma operação.
- O worker mantém uma requisição HTTP ativa enquanto processa. Tem orçamento de 120 segundos; uma chamada ao Rubeus pode aguardar até 60 segundos, respeitando o tempo restante. O Cloud Tasks e o Cloud Run permitem até 180 segundos nesta configuração.
- Depois que um worker adquiriu uma operação, ela não é executada automaticamente outra vez se o processo morrer. Isso evita uma segunda gravação após resultado incerto, mas exige conferência manual no portal se a instância falhar entre gravar no Rubeus e persistir o resultado. Não é garantia de execução exatamente uma vez no sistema externo.
- Uma falha incerta é mostrada na tela original com acesso ao portal, sem botão de concluir/fechar. Consultar novamente não reenvia a operação.
- Rejeição de validação devolve o formulário para correção e mostra o erro. Uma correção enviada com novo estado pode gerar uma nova operação.
- A proteção da entrega da prova agora usa um documento exclusivo no Firestore. Redis não é necessário para esta versão.

## Antes de executar implantar.sh

O script configura recursos no projeto talks-servidor:

1. Habilita Cloud Tasks e Firestore.
2. Cria o banco nomeado unibalsas-flow, em southamerica-east1, com proteção contra exclusão, se ainda não existir.
3. Cria a fila unibalsas-flow na mesma região, se ainda não existir.
4. Concede roles/cloudtasks.enqueuer e roles/datastore.user à conta de serviço atual do Cloud Run, no projeto. O papel de dados permite acesso aos bancos Firestore do projeto, não apenas a esse banco nomeado.
5. Ativa remoção por TTL de operações após duas horas e travas de entrega após sete dias. A remoção física por TTL não é imediata; a aplicação verifica a validade na consulta.
6. Publica o código, preservando os segredos existentes. Acrescenta apenas as variáveis FLOW_PROJECT_ID, FLOW_DATABASE_ID, FLOW_TASKS_REGION, FLOW_TASKS_QUEUE e FLOW_WORKER_ORIGIN.
7. Configura uma instância mínima aquecida, startup CPU boost, concorrência 20 e timeout HTTP 180s. A instância mínima e os novos serviços podem gerar cobrança. A instância aquecida reduz partida a frio; não torna a API Rubeus mais rápida.

O endpoint do serviço já é público no ambiente atual. O worker valida a assinatura HMAC antes de consultar ou executar uma tarefa. Se a política de acesso do Cloud Run mudar para exigir IAM, a configuração de autenticação das tarefas também precisará ser atualizada.

As chaves FLOW_PRIVATE_KEY/FLOW_PASSPHRASE, RBS_TOKEN e META_APP_SECRET existentes devem continuar configuradas. Não rotacione FLOW_PRIVATE_KEY enquanto houver operações pendentes: ela também protege os dados armazenados.

## Implantação pelo Cloud Shell

Envie cloud-run-flow-1.1.0.zip pelo menu Upload. Em uma aba livre:

```bash
flow_dir=$(mktemp -d /tmp/unibalsas-deploy-XXXXXX)
unzip "$HOME/cloud-run-flow-1.1.0.zip" -d "$flow_dir" &&
bash "$flow_dir/implantar.sh"
```

O script precisa de permissões administrativas para habilitar APIs, criar banco/fila e conceder os dois papéis. Se falhar, ele interrompe antes dos passos seguintes. Compartilhe a mensagem de erro, sem valores de segredos.

Esta versão EXIGE o novo flow-waba.json. Valide esse arquivo no editor da Meta e use-o com o novo backend. As três telas passam a declarar dados e ações de acompanhamento. Não misture o JSON antigo com este endpoint. Abra uma nova sessão de teste depois de atualizar ambos.

Confirme a implantação:

```bash
curl -sS https://devflowunibalsas-git-83531798597.southamerica-east1.run.app/api/flow
```

Versão esperada: unibalsas-cloudrun-durable-1.1.0.

Para logs estruturados:

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="devflowunibalsas-git" AND (jsonPayload.event="flow_job" OR jsonPayload.event="flow_worker_error" OR jsonPayload.event="rubeus_rejected" OR jsonPayload.event="flow_error")' --project=talks-servidor --freshness=30m --limit=30 --format=json
```

Após validar a implantação manual, sincronize também o GitHub com todos os arquivos api/, server.js, package.json, Dockerfile e o novo JSON. O upload ao Shell não altera o repositório.

## Validação realizada

36 testes locais passaram, incluindo webhook com assinatura e criptografia, APIs de Firestore/Tasks simuladas, aquisição concorrente, repetição de clique, retomada em outra instância, recusa de assinatura inválida, isolamento por flow_token, preservação de estado, worker que termina após 12 segundos sem novo submit e comparação de campos técnicos da abertura da prova.

Esses testes não são um teste no projeto Google real nem uma validação oficial do compilador WABA. A configuração do script foi conferida com a documentação Google; o script não foi executado na sua conta e a execução Bash não foi validada neste ambiente Windows. A integração real Rubeus, inclusive os erros 422 já vistos, continua dependendo da validação de ponta a ponta. A fila resolve a espera e o reenvio do mesmo pedido, não corrige por si só uma regra acadêmica ou validação rejeitada pelo servidor.

Persistem dois limites: a consulta de situação da prova pode depender da compatibilidade do token com a rota de leitura do site; a entrega de documentos ENEM ainda não está integrada. Não há promessa de sincronização imediata do feedback avaliação → CRM após entrega: deve ser conferida no portal.

## Fontes

- Cloud Tasks HTTP targets: https://docs.cloud.google.com/tasks/docs/creating-http-target-tasks
- Firestore createDocument: https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/createDocument
- Firestore patch/precondition: https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/patch
- Cloud Run minimum instances: https://docs.cloud.google.com/run/docs/configuring/min-instances
- Cloud Run development tips: https://docs.cloud.google.com/run/docs/tips/general
- Rubeus listagem: https://docs.rubeus.com.br/api_im/listagem/
- Rubeus métodos de inscrição: https://docs.rubeus.com.br/api_im/metodosdeinscricao/
