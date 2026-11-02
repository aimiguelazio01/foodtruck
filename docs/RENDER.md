# API e PostgreSQL no Render

O ficheiro `render.yaml` prepara três recursos pagos na região Frankfurt: API, worker e PostgreSQL, com disco persistente de 1 GB para imagens. Rever o orçamento apresentado pelo Render antes de aplicar o Blueprint. Estes ficheiros não ativam serviços por si só.

1. No Render, escolher **New → Blueprint**, ligar o repositório `aimiguelazio01/foodtruck` e usar a branch `master`.
2. Rever os recursos e custos. Preencher `MANAGEMENT_APP_URL` com a URL final da gestão e `CORS_ORIGINS` com as URLs de clientes e gestão separadas por vírgula, sem espaços nem barras finais.
3. Após autorizar a criação, aguardar o health check `/api/v1/health`. As migrações são executadas automaticamente, com bloqueio entre API e worker.
4. Copiar a URL HTTPS efetivamente atribuída à API para `INTERNAL_API_URL` dos dois projetos Vercel. A URL da API não deve ser presumida a partir do nome do serviço.
5. Seguir [VERCEL.md](VERCEL.md) e fazer novo deploy dos dois frontends.

## Primeira conta e dados

A base nasce vazia. Para uma instalação nova, no Shell da API, executar a partir de `/workspace/services/api`:

```sh
read -s -p 'Password inicial: ' FOODTRUCK_ADMIN_PASSWORD
export FOODTRUCK_ADMIN_PASSWORD
node ../../node_modules/tsx/dist/cli.mjs scripts/create-network-admin.ts owner@example.com "Food Truck Live"
unset FOODTRUCK_ADMIN_PASSWORD
```

Usar o email e o nome reais pretendidos. O comando cria o administrador; não gera encomendas nem menus de demonstração.

Para preservar os negócios locais existentes, migrar uma cópia de PostgreSQL e as imagens de `data/uploads` para a base e o disco remotos. Não executar a criação de administrador como substituto da migração. Os conteúdos da pasta `UPLOADS` destinados à introdução manual continuam guardados no GitHub.

Não há envio de email externo configurado por este Blueprint. Configurar SMTP_URL/MAIL_FROM quando necessário; sem SMTP, a recuperação e verificação são guardadas no outbox privado da API. O worker usa a mesma base, mas não precisa do disco de imagens.

Referências: https://render.com/docs/blueprint-spec e https://render.com/docs/disks
