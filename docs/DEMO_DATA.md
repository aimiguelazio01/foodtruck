# Dados demo — distribuição PostgreSQL

A distribuição usa deployment/demo/fixture.json, convertido das fontes fictícias originais. Inclui três negócios, 30 produtos com imagens individuais, 72 encomendas, contactos fictícios, contas de equipa, inventário, ingredientes, receitas, movimentos de stock, eventos e tarefas.

npm run demo abre uma base local independente em modo apenas consulta. No alojamento web, DEMO_MODE=1 e ALLOW_DEMO_SEED=1 permitem npm run seed numa base vazia; depois retire ALLOW_DEMO_SEED. A repetição preserva uma demo existente e recusa misturar dados reais.

Os ficheiros lib/demo.mjs, lib/demo-upgrades.mjs e scripts/export-demo-fixture.mjs são fontes de conversão de desenvolvimento e não entram no runtime distribuído. Não se distribui nenhuma base operacional. As datas do fixture ajustam-se ao primeiro seed; a manutenção nunca altera a demo.

As fotografias e recortes são ilustrações geradas de comida e carrinhas fictícias. São preservados os originais, atlas e 30 WebP transparentes, além de UPLOADS. Os mapas mantêm a atribuição OpenStreetMap. Não há fotografias de negócios reais nem hotlinks de bancos de imagens.
