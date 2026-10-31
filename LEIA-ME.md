# Flow 1.2.0 — vínculo da execução com a inscrição

## Diagnóstico real da inscrição 13948467

A auditoria executada pelo proprietário do projeto confirmou que o portal e o Flow se referem à mesma inscrição. A redação foi entregue na execução de avaliação 701942, com IDEXECPROVA 0A14C822CD. O formulário oficial e o formulário do site apontam IDEXECPROVA 79E0602B66, IDPROVAINSCRITO 45287. Essa divergência é suficiente para explicar o portal consultar uma execução diferente daquela que recebeu o texto. Ainda não foi identificado em qual ponto exato do servidor os dois códigos divergiram.

A configuração capturada do site mostra que o botão Iniciar prova distribui o caderno via ações TOTVS, consulta os dados e monta o link de avaliação. O campo Status da prova consulta o endpoint de status da avaliação usando a chave e IDEXECPROVA. Não basta obter finalizada=1 de uma execução sem conferir que o portal consulta o mesmo código.

## Correção implementada

1. Confirma no portal, com o token atual, o número da inscrição e o processo antes de abrir a prova.
2. Executa uma única ação do botão, com os campos recebidos no formulário.
3. Relê o passo pelo endpoint do site com execute_stage_query=0, sem executar novamente a distribuição.
4. Reconstrói o link a partir do forwardData do próprio formulário e dos valores atuais de content/applicantData. O código do redirecionamento anterior não é reutilizado quando diverge do código atual. Chave, candidato, oferta e execução precisam estar presentes; não há fallback para dados de outra inscrição.
5. Confere o ID da execução retornado pelo módulo de avaliação contra o vínculo confirmado e relê o vínculo antes de mostrar o editor.
6. Confere outra vez o vínculo antes de entregar. Se ele mudou, bloqueia a entrega; não transfere o texto automaticamente para outra execução.
7. Preserva cookies desde linkProva até a consulta, trata o código numérico conforme o cliente publicado do site e corrige as entidades HTML no enunciado.
8. Guarda o recibo de finalização e a auditoria no registro criptografado da tarefa. Não imprime chaves, cookies ou redação nos logs.
9. Só mostra a confirmação final após o portal da mesma inscrição reconhecer a entrega/correção. Enquanto a avaliação confirmou recebimento, mas o portal não confirmou a atualização, mostra Redação recebida com Verificar atualização. Essa ação faz consultas; não reenvia o texto.

As operações lentas continuam usando a fila e o Firestore já instalados. Não há nova infraestrutura nem dependências npm adicionais.

## Validação

58 testes locais passaram, incluindo o caminho de preparação, entrega e confirmação do portal com uma única gravação, redirecionamento desatualizado, valores de applicantData, rejeição de vínculo alterado, rotação de cookies, códigos numéricos e leitura de recibo sem reenvio. Um teste usa estrutura sanitizada do formulário capturado no REA.

O planejador de recuperação também foi executado com respostas simuladas e verificado para não imprimir credenciais ou texto da redação. Nada desta versão foi executado contra os registros reais pela assistência. O teste no Cloud Run/Rubeus e a validação do novo JSON no editor da Meta ainda são necessários; esses testes locais não são homologação de produção.

## Implantar o servidor

Envie o ZIP ao Cloud Shell. A fila e o banco da 1.1.0 devem continuar configurados. Para atualizar apenas código, preservando configuração existente:

```bash
flow_dir=$(mktemp -d /tmp/unibalsas-deploy-XXXXXX)
unzip "$HOME/cloud-run-flow-1.2.0.zip" -d "$flow_dir" &&
gcloud run deploy devflowunibalsas-git --project=talks-servidor --region=southamerica-east1 --source="$flow_dir"
```

Atualize também flow-waba.json na Meta. Ele declara titulo_processamento para as três telas dinâmicas. O botão de verificação de entrega usa as ações dinâmicas já existentes. Versão esperada do endpoint: unibalsas-cloudrun-binding-1.2.0.

Sincronize api/, server.js, package.json e os arquivos de implantação no GitHub. O upload ao Cloud Shell não altera o repositório. Testes e documentação são opcionais no runtime; são úteis no controle de versão. O JSON funciona na Meta e pode ser versionado no Git opcionalmente.

## Entrega antiga: planejar antes de recuperar

Atualizar o servidor não migra a redação da execução antiga 701942. Não sobrescreve o código da prova no TOTVS, não altera manualmente o status e não cria uma segunda entrega para esse registro.

Antes de qualquer recuperação, execute o planejador somente de leitura, na pasta extraída:

```bash
node "$flow_dir/planejar-recuperacao.mjs"
```

O padrão aponta para a tarefa já entregue informada no chat. Para outra tarefa, passe o ID como primeiro argumento. O script consulta a configuração do serviço e a tarefa criptografada com as permissões do proprietário; as chaves ficam apenas em memória. O plano inclui origem, destino, número da inscrição, tamanho/hash do texto, hash do enunciado, chave de definição compatível (somente booleano) e se a entrega original ocorreu dentro do prazo. Ele NÃO chama submit, linkProva, create ou salve.

A recuperação de uma redação já entregue entre duas execuções é uma operação separada e precisa ser revisada/autorizada com esses dados. O mecanismo de recuperação que efetivamente grava não está incluído neste pacote. Não se deve reaproveitar o texto em uma questão/enunciado diferente nem sobrescrever uma execução já finalizada. Os registros das tarefas têm retenção e podem ser removidos por TTL; por isso, o plano pode ficar indisponível se a tarefa expirar.

## Logs para uma tentativa nova

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="devflowunibalsas-git" AND (jsonPayload.event="proof_binding" OR jsonPayload.event="proof_receipt" OR jsonPayload.event="proof_portal_check" OR jsonPayload.event="flow_job" OR jsonPayload.event="flow_error")' --project=talks-servidor --freshness=30m --limit=40 --format=json
```

proof_binding registra o código atual usado na abertura. proof_receipt registra a execução e o código efetivamente finalizados. proof_portal_check registra se o portal confirmou a atualização. Esses dados devem coincidir para a mesma inscrição.

## Limites

A rel leitura usa o estado que o servidor devolve; não é uma transação distribuída com o TOTVS. Se um sistema externo redistribuir a prova durante o processo, a versão bloqueia o vínculo divergente e pede conferência. O worker não repete automaticamente uma gravação de resultado incerto. A recuperação de falha entre gravar no Rubeus e guardar o recibo segue exigindo conferência manual.

A integração de documentos ENEM permanece pendente. As tarefas usam a configuração de TTL de duas horas, a trava de entrega dura sete dias e o estado do Flow é autenticado por até três horas, respeitando o prazo efetivo da avaliação para a entrega. Uma instância mínima continua aquecida, com custos correspondentes.

## Fontes e evidência

O passo capturado do site mapeia IDEXECPROVA para BEXECPROVA e Status da prova para https://avaliacao.apprubeus.com.br/api/avaliacao/status. O JavaScript público de execução foi relido com REA: https://avaliacao.apprubeus.com.br/17-es2015.913b512825323118bce3.js (SHA-256 6e15cef6f0dcb2dc6e8781d87878870fb5a7755326c9beff9874f0348081bb6d). Não foi encontrado nesse trecho um callback separado do frontend que pudesse substituir a conferência de vínculo.

API oficial de metadados: https://docs.rubeus.com.br/api_im/listagem/
Métodos de formulário: https://docs.rubeus.com.br/api_im/metodosdeinscricao/
Fila: https://docs.cloud.google.com/tasks/docs/creating-http-target-tasks
