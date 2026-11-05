# Permissões do token da API Cloudflare

Token **de conta** (não de utilizador) usado pelo serviço de plataforma para instalar e remover sites
(`desktop/launcher/cloudflare/*.go`). Verificado contra a referência oficial
(https://developers.cloudflare.com/api/) em 2026-11-05.

Nomes: o painel de criação de tokens mostra `Edit`/`Read`; as páginas da API mostram `Write`/`Read`
para o mesmo grupo (ex.: "D1 Edit" = "D1 Write").

## Grupos a escolher no painel

| Âmbito | Grupo (painel) | Nível | Porquê |
|---|---|---|---|
| Conta | Workers Scripts | Edit | publicar/apagar Workers, subdomínio workers.dev, cron, assets, **Custom Domains** |
| Conta | D1 | Edit | criar, consultar, exportar, importar e apagar a base de dados |
| Conta | Workers R2 Storage | Edit | criar o bucket, regra de ciclo de vida, apagar o bucket |
| Conta | Billing | Read | preflight: confirmar subscrição Workers Paid |
| Conta | Account Settings | Read | listar contas (`GET /accounts`) — a página não indica permissão; incluir por precaução |
| Zona (domínio do operador) | Workers Routes | Edit | por precaução para Custom Domains — **não documentado** na página do endpoint; confirmar no teste real |

Recursos da conta: só a conta do operador. Recursos da zona: só o domínio usado para `<slug>.<domínio>`.

## Endpoints e permissão documentada

| Endpoint | Permissão aceite (docs) | Documentação |
|---|---|---|
| `GET /accounts` | nenhuma indicada | https://developers.cloudflare.com/api/resources/accounts/methods/list/ |
| `GET /accounts/{id}/subscriptions` | Billing Read / Write | https://developers.cloudflare.com/api/resources/accounts/subresources/subscriptions/methods/get/ |
| `GET /accounts/{id}/d1/database` | D1 Read / Write | https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/list/ |
| `POST /accounts/{id}/d1/database` | D1 Write | https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/create/ |
| `GET /accounts/{id}/d1/database/{db}` | D1 Read / Write | https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/get/ |
| `DELETE /accounts/{id}/d1/database/{db}` | D1 Write | https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/delete/ |
| `POST .../d1/database/{db}/query` | D1 Read / Write | https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/ |
| `POST .../d1/database/{db}/export` | não indicada (D1) | https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/ |
| `POST .../d1/database/{db}/import` | não indicada (D1) | https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/import/ |
| `GET /accounts/{id}/r2/buckets` | Workers R2 Storage Read / Write | https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/list/ |
| `POST /accounts/{id}/r2/buckets` | Workers R2 Storage Write | https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/create/ |
| `PUT .../r2/buckets/{nome}/lifecycle` | Workers R2 Storage Write (guia) | https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/lifecycle/methods/update/ · https://developers.cloudflare.com/r2/buckets/object-lifecycles/ |
| `DELETE .../r2/buckets/{nome}` | Workers R2 Storage Write | https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/delete/ |
| `GET /accounts/{id}/workers/scripts` | Workers Scripts Read / Write | https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/list/ |
| `PUT .../workers/scripts/{nome}` | Workers Scripts Write | https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/ |
| `DELETE .../workers/scripts/{nome}` | Workers Scripts Write | https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/delete/ |
| `GET .../workers/scripts/{nome}/settings`, `/script-settings`; `GET/POST .../subdomain`; `PUT .../schedules`; `POST .../assets-upload-session`; `POST .../workers/assets/upload` | Workers Scripts (não confirmado página a página) | https://developers.cloudflare.com/api/resources/workers/subresources/scripts/ |
| `GET /accounts/{id}/workers/subdomain` | Workers Scripts Read / Write | https://developers.cloudflare.com/api/resources/workers/subresources/subdomains/methods/get/ |
| `GET /accounts/{id}/workers/domains?hostname=` | Workers Scripts Read / Write | https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/list/ |
| `PUT /accounts/{id}/workers/domains` | Workers Scripts Write | https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/ |
| `DELETE /accounts/{id}/workers/domains/{domain_id}` | Workers Scripts Write | https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/delete/ |

## A confirmar no primeiro teste real

- Custom Domains: a página do `PUT` só exige Workers Scripts Write, mas o pedido cria DNS e um
  certificado na zona. Se falhar com 403/10000, a permissão de zona em falta é a causa provável.
- Um hostname já ligado a outro Worker: a API não documenta se o `PUT` substitui ou recusa. O código
  consulta antes (`GET ?hostname=`) e recusa — não remover essa verificação.
- O hostname não pode ter um registo CNAME existente na zona.
- R2: a regra de ciclo de vida apaga objetos "normalmente em 24 h" após aplicar; o `DELETE` do bucket
  devolve 409 (código 10008 BucketNotEmpty) até lá, e o teardown devolve `ErrStoragePending`.
