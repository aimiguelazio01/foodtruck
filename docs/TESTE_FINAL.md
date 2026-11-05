# Teste final real — checklist de aceitação

Pré-requisito: [`SETUP_REAL.md`](SETUP_REAL.md) concluído, e `platform -check` sem nenhum ✘.

Preencha a coluna **Resultado** com ✔/✘, a data e a evidência: email recebido, URL, ID do evento Stripe, captura do painel Cloudflare. Uma linha com ✘ trava a venda até ser corrigida e repetida. Esta lista serve de modelo para outras aplicações; os passos 2–12 aplicam-se a qualquer app instalada pelo portal.

Comandos de apoio (na pasta do projeto):

```bash
docker compose --env-file deployment/platform/.env -f deployment/platform/compose.yaml logs -f service
```

```bash
docker compose --env-file deployment/platform/.env -f deployment/platform/compose.yaml exec database psql -U platform -d platform
```

Na consola `psql`, para encontrar a encomenda de um email:

```sql
SELECT o.id, o.plan_status, o.active_until, o.suspended_at FROM portal_orders o JOIN portal_customers c ON c.id=o.customer_id WHERE c.email='o-seu@email';
```

Erros do API Worker de um site (diagnóstico de HTTP 503):

```bash
npx wrangler tail teste-api --format json
```

| # | Passo | Resultado esperado | Resultado |
|---|---|---|---|
| 1 | `platform -check` | Todas as linhas ✔ | |
| 2 | Abrir `https://instalar.<DOMINIO>`, criar conta com um email seu | **Email de confirmação real recebido** (verificar também o spam). O link abre o portal com sessão iniciada | |
| 3 | Preencher o negócio com o nome `teste` | O endereço aparece como disponível. A barra de progresso avança sozinha até "Pronto", com QR | |
| 4 | Abrir `https://teste.<DOMINIO>` e `https://teste-gestao.<DOMINIO>` | Os dois abrem em HTTPS, com cadeado válido | |
| 5 | Na gestão: iniciar sessão com a palavra-passe de administração | Entra em menos de 2 s, sem erro 503. Anotar o tempo de PBKDF2 mostrado no `wrangler tail` | |
| 6 | Na gestão: criar um produto com imagem | O produto e a imagem aparecem no site de encomendas | |
| 7 | No site: registar um cliente com outro email | Email de verificação recebido. O link confirma a conta | |
| 8 | No site: fazer uma encomenda | A encomenda aparece na gestão | |
| 9 | No site: "Esqueci-me da palavra-passe" | Email recebido. A palavra-passe nova funciona | |
| 10 | Gestão: recuperar a palavra-passe da equipa | Email recebido. A palavra-passe nova funciona | |
| 11 | Portal: **Subscrever** com o cartão `4242 4242 4242 4242` (data futura, CVC qualquer) | Volta ao portal com "Ativo". Na Stripe, **Webhooks → endpoint** mostra os eventos entregues com 200 | |
| 12 | Portal: **Gerir pagamento** | O Customer Portal da Stripe abre | |
| 13 | No Customer Portal: trocar o cartão para `4000 0000 0000 0341` e, na Stripe, **Invoices → criar/pagar** a próxima fatura (ou usar um *test clock*) | `invoice.payment_failed` chega. O plano fica `past_due` e o site continua no ar até ao fim do período pago | |
| 14 | No Customer Portal: cancelar | O portal mostra "termina no fim do período" (`cancelAtPeriodEnd`) | |
| 15 | Lembretes: no `psql`, `UPDATE portal_orders SET active_until=now()+interval '2 days' WHERE id='…';` e esperar até 10 min. Depois `+interval '12 hours'` | Email "faltam 3 dias" e depois "falta 1 dia" | |
| 16 | Suspensão: `UPDATE portal_orders SET active_until=now()-interval '1 minute' WHERE id='…';` e esperar até 10 min | Plano `suspended`, email recebido. Em menos de 1 min o site mostra a página "temporariamente indisponível" (402) | |
| 17 | Reativar: subscrever de novo no portal (cartão `4242…`) | O site volta em menos de 1 min | |
| 18 | Backup: no portal (`/avancado`), pedir backup SQL + imagens e depois validar o restauro | Backup "pronto"; validação "verified" | |
| 19 | Resiliência: parar o túnel (`docker compose … stop tunnel`) durante 15 min | `teste.<DOMINIO>` continua a funcionar. Depois, `start tunnel` | |
| 20 | Remoção: criar outra instalação de teste (`teste2`, com outra conta). Pôr `PLATFORM_TEARDOWN_APPROVED=true`, reiniciar, suspender (passo 16) e depois `UPDATE portal_orders SET suspended_at=now()-interval '31 days' WHERE id='…';` | Primeiro uma cópia final, depois a remoção. Em **Workers & Pages**, **D1**, **R2** e **Workers → Custom Domains** já não existe nada de `teste2` (o bucket R2 pode demorar 1–2 dias a desaparecer, pela regra de expiração). Voltar a pôr `false` | |
| 21 | Stripe live: ativar a conta (dados fiscais, IBAN), criar o produto/preço, a chave e o webhook **live**. Trocar os 3 valores `STRIPE_*` no `.env`, reiniciar e voltar a correr `-check` (deve dizer "PRODUÇÃO") | `-check` ✔ | |
| 22 | Pagamento real: subscrever com um cartão real e depois reembolsar em **Payments → Refund** | Pagamento recebido e reembolsado. Webhooks entregues com 200 | |
| 23 | Registar o resultado em `PROJECT_CONTEXT.md` | — | |

## Depois do teste

- Pôr `PLATFORM_TRIAL_DAYS` e o preço finais.
- Decidir se o portal continua no PC ou passa para um VPS. O mesmo `compose.yaml` funciona com `--profile public` (Caddy) num servidor com IP público.
- Antes de vender, ainda faltam: termos de serviço, política de privacidade, faturação com IVA e alertas ao operador.

## Resultado do teste real de 2026-11-05 (modo gratuito, sem domínio)

Feito num PC Windows com Docker, túnel rápido, Stripe em modo de teste e o Gmail do operador como remetente.

| Passo | Resultado | Evidência |
|---|---|---|
| Registo com email real | ✔ O email de confirmação chegou (Brevo) | Email recebido |
| Instalação real do negócio | ✔ Depois de corrigir o erro 503 (ver abaixo) | Worker `…-customer` responde `configured:true` |
| Gestão: entrar e criar produto | ✔ O produto aparece no site do cliente | Menu público com "Hotdog 4,50 €" |
| Subscrever (cartão `4242…`) | ✔ `checkout.session.completed` e `invoice.paid` com 200; plano `active` | `portal_orders.plan_status='active'` |
| Pagamento recusado, cancelar, suspender, reativar, backup, remoção | Por fazer (passos 13 a 20) | — |
| Medir o CPU do login (PBKDF2) | Por fazer | — |

**Problema encontrado e corrigido:** os Workers recusam `fetch(..., { redirect: 'error' })` ("Invalid redirect value"). Isso fazia todo o site novo responder 503 e partia o envio de emails dos sites. Corrigido em `subscription.mjs` e `mail.mjs`, com um teste que impede o regresso.

**Limites conhecidos:**
- O instalador fixa a versão do pacote por pedido: para usar um pacote novo é preciso um pedido novo.
- A vista **Rede** da gestão mostra "Página não encontrada": faltam no API dos Workers as rotas `/network/<org>`, `availability`, `shifts`, `templates` e `transfers`.
- Um cliente que entra sem pedido não consegue criar o espaço (o pedido só nasce ao confirmar o email).
- Com Gmail como remetente os emails podem ir para spam.

## Demonstração partilhada

Um único site de demonstração com dados fictícios, na conta Cloudflare do operador. Plano e decisões em `docs/DEMO_PLAN.md`.

| # | Passo | Resultado esperado | Obtido |
|---|---|---|---|
| D1 | Instalar: `go -C desktop/launcher run ./cmd/platform -demo-install -env ../../deployment/platform/.env` (na raiz do projeto, com o Node) | Escreve `PLATFORM_DEMO_CUSTOMER_URL` e `PLATFORM_DEMO_MANAGEMENT_URL` no `.env` | ✔ 949 instruções de dados |
| D2 | `…/api/v1/installation/status` do site demo | `{"configured":true,"demo":true,"readOnly":false}` | ✔ |
| D3 | Abrir `<gestão demo>/demo` | Entra sozinho; faixa "Demonstração — experimente à vontade"; 3 negócios | ✔ |
| D4 | Tentar pagar uma encomenda, mudar a empresa ou registar um cliente na demo | 403 "Demonstração: esta ação não está disponível" | ✔ (testes automáticos e 1 verificação real) |
| D5 | Reiniciar o painel e abrir a página do painel | Bloco "Quer ver como funciona primeiro?" com 2 botões | ✔ |
| D6 | No dia seguinte, alterar dados na demo e esperar a reposição | Os dados originais voltam (o cron repõe uma vez por dia) | Por verificar na conta real |
