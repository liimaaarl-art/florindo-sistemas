# Gabriel Barbeiro — demonstração

`index.html` é a página pública de agendamento. `admin.html` é o painel de Gabriel para agenda, clientes, serviços, pagamentos e ajustes. Ambos usam os mesmos dados do banco.

## Regras da demonstração

A demonstração mantém **somente dois limites comerciais**: até **3 clientes** e até **3 serviços/valores**. Dentro desses três serviços, Gabriel pode usar qualquer nome, valor e duração permitidos. Os agendamentos não têm limite comercial de três; existe apenas o limite técnico geral de segurança do banco.

A propriedade `settings.demoMode` controla esses limites. Enquanto for diferente de `false`, a API valida no servidor o máximo de 3 clientes e 3 serviços. Após a efetivação do contrato, o modo demonstração pode ser desativado para remover esses dois limites.

## Agenda

Os dias de atendimento são configuráveis pelo painel. O padrão para registros antigos é **segunda a sexta-feira**. Também é possível fechar uma data específica inteira, por exemplo quando Gabriel tiver um compromisso. Fechar uma data impede novos agendamentos naquele dia, mas não cancela automaticamente compromissos que já existiam.

A página pública respeita abertura, fechamento, intervalo da grade, dias de atendimento, datas fechadas e conflitos de horário. O horário de fechamento configurado no painel é usado tanto na interface quanto na validação do servidor.

## Clientes

O painel permite editar e excluir clientes. Ao excluir um cliente, o painel avisa quantos agendamentos estão vinculados e, após confirmação, remove também esses agendamentos para não deixar registros órfãos.

## WhatsApp e lembrete

O painel destaca automaticamente os clientes confirmados que têm horário no dia seguinte e gera a mensagem de lembrete pronta. O envio atual continua sendo realizado pelo WhatsApp ao tocar no botão de envio. **Envio automático sem interação exige uma integração oficial de mensageria/WhatsApp Business e um agendador no servidor; esta demonstração não simula esse envio como se já estivesse conectado.**

## Backend

A API fica em `api/gabriel.mjs`, com a lógica compartilhada em `api.mjs` e validação em `validation.mjs`. Credenciais e `DATABASE_URL` permanecem somente no ambiente de hospedagem, nunca no HTML ou repositório.
