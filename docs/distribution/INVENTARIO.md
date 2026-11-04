# Inventário da distribuição

## Aplicação suportada

`apps/customer` e `apps/management` são os sites atuais. `services/api` implementa a API PostgreSQL, migrações e manutenção; `packages/backend` contém contratos partilhados.

## Versão SQLite anterior

As pastas de raiz `app`, `lib`, `db`, os testes antigos em `tests` e `e2e`, os scripts SQLite de setup/start/backup/worker e os modelos Docker/Render antigos não são utilizados pelos percursos distribuídos. São excluídos do pacote por `scripts/release-files.json`. Os comandos públicos de setup, seed e worker passam a usar a arquitetura PostgreSQL; os atalhos legacy foram removidos.

O gerador de dados demo em `lib` é preservado como fonte histórica e é utilizado apenas pelo conversor de desenvolvimento `scripts/export-demo-fixture.mjs`. A demo distribuída usa `deployment/demo/fixture.json`, sem SQLite em execução. Nenhum ficheiro histórico do ambiente de trabalho é apagado para obter uma distribuição limpa.

## Recursos preservados

São incluídos os recursos dos dois sites, imagens demo individuais e originais, a pasta `UPLOADS`, fontes Markdown e PDFs dos manuais. `UPLOADS` contém material de conteúdo original; uploads reais vão para `data/<perfil>/uploads` ou storage externo e são excluídos.

## Exclusões

Não entram segredos, `.env.install`, `.env.local`, `data`, dumps, dependências, builds, Git, relatórios de testes, diretórios temporários ou ZIPs anteriores. O empacotador recusa links simbólicos nos ficheiros e verifica padrões de chaves privadas e credenciais conhecidas.

## Entrega 1.0.1

release/marketplace contém apenas o ZIP e INICIAR.mjs. O manifesto está dentro do ZIP; o iniciador exterior inclui o checksum do arquivo. INICIAR.cmd deixa de fazer parte da distribuição. O iniciador universal instala código em .foodtruck/releases e guarda os dados em .foodtruck/data.
