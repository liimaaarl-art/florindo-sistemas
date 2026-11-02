-- Preparado para análise: remove apenas o limite legado de três agendamentos.
-- Não altera os limites de clientes/serviços nem apaga registros.
-- Aplicar somente após autorização e teste em uma cópia da branch gabriel-barbearia-demo.
ALTER TABLE public.gabriel_demo_state
  DROP CONSTRAINT gabriel_demo_state_data_check1;
