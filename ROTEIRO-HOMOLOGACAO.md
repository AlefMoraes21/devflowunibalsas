# Roteiro de homologação antes de liberar para todos

Antes de remover a trava `AVISOS_SO_PARA`. Sempre com candidato **fictício** (4devs) e o celular de teste que já está na
trava. Nada aqui exige mexer no código.

Logs (PowerShell):

```powershell
gcloud logging read 'resource.labels.service_name="devflowunibalsas-git" AND jsonPayload.event:("etapa1_fila" OR "redacao_vigia" OR "etapa_aviso" OR "blip_aviso" OR "proof_")' --project talks-servidor --freshness=2h --limit 50 --format="value(timestamp,jsonPayload)"
```

## 1. Segunda redação (reprovado refaz pelo LOGIN) — 2.17.4

O que queremos descobrir: quando o candidato é reprovado, o Rubeus monta a 2ª tentativa como **nova execução** da prova
ou reaproveita a mesma? O worker só envia se reconhecer a prova; se não reconhecer, a fila vai para a equipe (nada é
reenviado às cegas).

1. **Inscrição nova no Vestibular (20383)** pelo Flow, com um candidato fictício e o celular de teste. Escreva uma redação
   fraca de propósito (curta, sem desenvolvimento, mas aceita pelo Flow).
   - Esperado no log: `etapa1_fila` até `status: concluida`; `proof_receipt` com o `executionCode` da 1ª tentativa.
   - Anote o horário da entrega.
2. **Pedir à equipe** para corrigir essa redação no Rubeus com nota abaixo do mínimo (a correção é humana).
3. **Aviso de reprovação**: o vigia da redação manda no WhatsApp "não atingiu a nota necessária… pode realizar a
   avaliação mais uma vez". Log: `redacao_vigia` com `passo: reprovada`.
4. **Esperar pelo menos 1 h desde a 1ª entrega.** Antes disso o LOGIN mostra "Redação enviada" (proteção contra o portal
   ainda sincronizando) — isso é o esperado.
5. **LOGIN** (CPF + nascimento) no Flow. O portal precisa mostrar a prova liberada de novo.
   - Esperado: o Flow abre a redação; log `etapa1_fila` com `login_prova` e `redacao_refazer`.
6. **Escrever a 2ª redação** (agora boa) e enviar.
   - Esperado: ~10 min de calma, depois `etapa1_fila` passando por `redacao_enviar` e `entrega` até `status: concluida`
     (se aparecer `prova_instavel` ou `reenvio_prova_atual`, anote: é o Rubeus trocando a execução).
   - Compare o `executionCode` do `proof_receipt` com o da 1ª tentativa e anote se mudou.
7. **No portal do candidato** (vestibular.unibalsas.edu.br/presencial): a prova deve aparecer com a 2ª entrega
   "Aguardando correção".

Resultado:
- Deu certo → me passe os dois `executionCode` (só os códigos, sem CPF) para eu registrar como **confirmado**.
- A fila foi para `conferir` → me passe o `ultimo_erro`/`motivo` do log. É a proteção funcionando; ajusto com base no
  comportamento real do Rubeus.

## 2. Pago → Recebido → Matriculado

1. Candidato fictício até a tela **Pagamento**, com o celular de teste.
2. Tocar em **Realizar pagamento** → chega a mensagem com Pix + link do cartão (uma só).
3. Pagar o valor de teste combinado com a equipe (ex.: R$ 1,00) — **feito por você**.
4. Esperado em até ~2 min: portal "Pagamento: Recebido" e aviso "Recebemos o pagamento" no WhatsApp.
5. Equipe dá a baixa → portal "Matriculado" → aviso "Sua matrícula foi confirmada" (o vigia confere a cada 30 min).

## 3. Jornada completa com número controlado

Repetir inscrição → redação/documentos → matrícula → pagamento num número de teste diferente do atual, colocado na
trava (`AVISOS_SO_PARA`) só para isso. Conferir que cada aviso chega **uma vez**. Só depois disso remover a trava.

## 4. Duas inscrições no mesmo CPF (2.17.8)

Depois de publicar o JSON novo na Meta e ligar `TELAS_INSCRICAO_MULTIPLA=on`:
1. Com um CPF fictício que já tem inscrição (ex.: Vestibular), começar outra (ex.: Transferência) e tocar em Concluir.
   - Esperado: tela "Você já possui uma inscrição" com o processo e o curso. Log `ja_inscrito_outro_processo`.
2. "Seguir com a inscrição atual": abre o portal da existente; a nova não é criada (`seguiu_inscricao_existente`).
3. Repetir e escolher "Fazer uma nova inscrição": segue para "Obrigado…" e os documentos; o worker entrega na inscrição
   certa (log `portal_site` `troca_inscricao`).
4. LOGIN com esse CPF: tela "Suas inscrições" para escolher qual acompanhar.

## Cobrança (2.17.6) — o que esperar

- Toque em "Realizar pagamento": uma mensagem. Se o Blip não responder (tempo esgotado/erro dele), a mensagem **não é
  repetida sozinha**: a tela mostra "Enviamos…" e o candidato pode tocar em **Reenviar mensagem**. Log de atenção
  `blip_sem_resposta` ou `envio_interrompido`.
- Recusa clara do Blip (ele disse que não mandou): tenta de novo em 2 min, até 5 vezes, com o mesmo Pix.
- Celular fora da trava de teste: **nenhum Pix é gerado** e a tela orienta pagar pelo Portal do candidato, sem alerta
  para a equipe.
