# Montagem real do alojamento gerido — guia passo a passo

Este guia prepara tudo o que é preciso para o **teste final real**: emails verdadeiros, pagamentos Stripe, sites publicados na Cloudflare num endereço seu. Não há nada simulado.

Está dividido em duas partes:

- **Parte 1 — Contas do operador.** Faz-se **uma vez** e serve para esta e para as próximas aplicações.
- **Parte 2 — Por aplicação.** Repete-se para cada aplicação nova.

Ao longo do guia, `<DOMINIO>` é o domínio que vai usar (por exemplo `exemplo.pt`). O portal do operador fica em `instalar.<DOMINIO>`. Os sites dos clientes ficam em `<nome>.<DOMINIO>` e `<nome>-gestao.<DOMINIO>`.

> **Regras de segurança**
> - Cada valor secreto vai **apenas** para `deployment/platform/.env`, um ficheiro que nunca entra no Git. Não o envie por chat, email ou captura de ecrã.
> - Se algum valor secreto vazar, revogue-o no painel do serviço e crie outro.

> **Sem domínio (conta grátis)?** O guia interativo [`guia-setup.html`](guia-setup.html) trata disso: escreva só um nome (ex.: `meunegocio`) em vez de um domínio e os passos ajustam-se ao endereço gratuito `workers.dev`. As diferenças são:
> - **Sites:** ficam em `foodtruck-…-customer.meunegocio.workers.dev`. Deixe `PLATFORM_SITE_DOMAIN` e `PLATFORM_SITE_ZONE_ID` vazios; o token não precisa de permissões de zona.
> - **Portal:** não há endereço fixo. Use um túnel rápido (`cloudflared tunnel --url http://localhost:4200`), que muda de endereço sempre que arranca. Serve para o teste, não para vender.
> - **Stripe:** sem webhook público; use `stripe listen --forward-to localhost:4100/stripe/webhook`.
> - **Brevo:** sem domínio não há autenticação DKIM, por isso os emails podem ir para o spam.
>
> O resto do guia (passos 8 a 12) aplica-se igual.

Custos previstos para o teste: Cloudflare Workers Paid (5 USD/mês), o domínio (cerca de 10–20 €/ano) e um pagamento real baixo na Stripe, depois reembolsado. A Brevo e a Stripe em modo de teste são gratuitas.

---

## Parte 1 — Contas do operador (uma vez)

### 1. Cloudflare: conta e plano

1. Vá a <https://dash.cloudflare.com/sign-up> e crie a conta com o email do negócio.
2. Ative a autenticação de dois fatores: **ícone do perfil → My Profile → Authentication → Two-Factor Authentication**.
3. Ative o Workers Paid: **Compute (Workers) → Workers & Pages → Plans → Workers Paid → Purchase**. Indique um cartão.
4. Ative o R2: **R2 Object Storage → Purchase R2 / Get started**. O plano gratuito chega, mas a Cloudflare pede o cartão.
5. Anote o **Account ID**, que aparece na página **Workers & Pages** na coluna da direita, ou no URL do painel `dash.cloudflare.com/<ACCOUNT_ID>/…`.
   → `.env`: `PLATFORM_CLOUDFLARE_ACCOUNT=<Account ID>`

### 2. Domínio na Cloudflare

1. Registe `<DOMINIO>` num registrar. Os `.pt` registam-se, por exemplo, na PTisp, Amen ou Dominios.pt. Outros domínios (`.com`, `.app`) podem ser registados diretamente na Cloudflare em **Domain Registration → Register Domains**; nesse caso, salte para o ponto 4.
2. Na Cloudflare: **Account Home → Add a domain** → escreva `<DOMINIO>` → plano **Free** → continue.
3. A Cloudflare mostra **dois nameservers** (ex.: `ada.ns.cloudflare.com`). No painel do registrar, substitua os nameservers atuais por estes dois. Num `.pt` a alteração pode demorar umas horas.
4. Espere até a Cloudflare mostrar o domínio como **Active**. Recebe também um email da Cloudflare.
5. Abra o domínio. Na página **Overview**, coluna da direita, copie o **Zone ID**.
   → `.env`: `PLATFORM_SITE_DOMAIN=<DOMINIO>` e `PLATFORM_SITE_ZONE_ID=<Zone ID>`
6. Em **SSL/TLS → Overview**, escolha **Full (strict)**.

### 3. Token API da Cloudflare (o instalador)

1. **Ícone do perfil → My Profile → API Tokens → Create Token → Create Custom Token**.
2. Nome: `foodtruck-instalador`.
3. Permissões. Adicione uma linha para cada uma:

   | Tipo | Permissão | Nível |
   |---|---|---|
   | Account | Workers Scripts | Edit |
   | Account | D1 | Edit |
   | Account | Workers R2 Storage | Edit |
   | Account | Billing | Read |
   | Account | Account Settings | Read |
   | Zone | Workers Routes | Edit |
   | Zone | Zone | Read |

   A razão de cada permissão está em [`cloudflare-token-permissions.md`](cloudflare-token-permissions.md), confirmada contra a documentação oficial. **Workers Routes** é uma precaução para os domínios dos sites. **Zone Read** serve para a verificação prévia. Se a ligação do endereço falhar com 403 no teste real, acrescente **Zone → DNS → Edit**.
4. **Account Resources:** Include → *a sua conta*. **Zone Resources:** Include → Specific zone → `<DOMINIO>`.
5. Opcional: em **Client IP Address Filtering**, restrinja ao IP do seu PC. Atenção: se o seu IP mudar, o token deixa de funcionar.
6. **Continue to summary → Create Token.** O token **só é mostrado uma vez**.
   → `.env`: `PLATFORM_CLOUDFLARE_TOKEN=<token>`

### 4. Cloudflare Tunnel (publica o portal do seu PC)

O túnel liga o portal no seu PC à Internet em HTTPS, sem abrir portas no router.

1. **Zero Trust** (menu da esquerda). Da primeira vez, escolha um nome de equipa e o plano **Free**. Pode pedir um cartão, mas o plano não tem custo.
2. **Networks → Tunnels → Create a tunnel → Cloudflared**. Nome: `painel`.
3. Em **Install and run a connector**, escolha **Docker**. O comando mostrado tem `--token eyJ…`. Copie **só o valor do token**, sem correr o comando: o Docker Compose corre o conector por si.
   → `.env`: `CLOUDFLARE_TUNNEL_TOKEN=<token>`
4. **Next → Public Hostnames**. Crie duas rotas, **por esta ordem** (a mais específica primeiro):

   | Subdomain | Domain | Path | Type | URL |
   |---|---|---|---|---|
   | `instalar` | `<DOMINIO>` | `^/stripe/webhook` | HTTP | `service:4100` |
   | `instalar` | `<DOMINIO>` | *(vazio)* | HTTP | `portal:4200` |

   A primeira rota envia os avisos da Stripe diretamente ao serviço, com o corpo intacto para a verificação da assinatura. A segunda serve o portal.
5. → `.env`: `PLATFORM_PUBLIC_HOST=instalar.<DOMINIO>` e `PLATFORM_ORIGIN=https://instalar.<DOMINIO>`

O PC tem de estar ligado para o portal funcionar. Os sites dos clientes **não** dependem do PC: correm na Cloudflare e aguentam até 72 h sem o portal.

### 5. Brevo (emails)

1. Crie a conta em <https://onboarding.brevo.com/account/register>. O plano Free permite 300 emails/dia.
2. Autentique o domínio: **ícone da conta → Senders, Domains & Dedicated IPs → Domains → Add a domain** → `<DOMINIO>`.
   - Se aparecer **Authenticate automatically with Cloudflare**, use essa opção: a Brevo cria os registos sozinha.
   - Caso contrário, copie cada registo (o TXT `brevo-code`, os registos DKIM e o TXT `_dmarc`) para **Cloudflare → `<DOMINIO>` → DNS → Records → Add record**. Use o mesmo tipo, nome e valor, com **Proxy desligado** (nuvem cinzenta).
   - Volte à Brevo e carregue em **Authenticate this email domain**. O estado tem de ficar **Authenticated**.
3. Crie o remetente: **Senders → Add a sender** → nome `Food Truck Live`, email `nao-responder@<DOMINIO>`. Com o domínio autenticado, o remetente fica ativo.
   → `.env`: `PLATFORM_MAIL_FROM=Food Truck Live <nao-responder@<DOMINIO>>`
4. Crie a chave API: **ícone da conta → SMTP & API → API Keys & MCP → Generate a new API key**. Nome `foodtruck`. A chave começa por `xkeysib-` e só é mostrada uma vez.
   → `.env`: `PLATFORM_BREVO_API_KEY=<chave>`
5. **Importante:** em **Security → Authorised IPs**, **desative o bloqueio de IPs desconhecidos**. Os sites dos clientes enviam emails a partir de servidores da Cloudflare, cujos IPs mudam. Com o bloqueio ligado, a Brevo recusa esses emails.

### 6. Stripe (pagamentos) — modo de teste

1. Crie a conta em <https://dashboard.stripe.com/register>. Ainda não ative pagamentos reais.
2. Confirme que o interruptor **Test mode** (ou **Sandbox**) está ligado no topo do painel.
3. Crie o produto: **Product catalog → Add product**.
   - Nome: `Alojamento Food Truck Live`
   - **Recurring**, **Monthly**, preço em **EUR** (ex.: 15,00)
   - Guarde. Abra o preço e copie o ID `price_…`.
   → `.env`: `STRIPE_PRICE_ID=<price_…>`
4. Copie a chave secreta: **Developers → API keys → Secret key** (`sk_test_…`).
   → `.env`: `STRIPE_SECRET_KEY=<sk_test_…>`
5. Crie o webhook. Só depois de o túnel estar a funcionar (passo 9 da Parte 2).
   1. **Developers → Webhooks → Add endpoint**. URL: `https://instalar.<DOMINIO>/stripe/webhook`.
   2. Eventos (selecione exatamente estes 5): `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`.
   3. Guarde. Em **Signing secret → Reveal**, copie o `whsec_…`.
   → `.env`: `STRIPE_WEBHOOK_SECRET=<whsec_…>`
6. Configure o Customer Portal: **Settings → Billing → Customer portal**. Ative a atualização de métodos de pagamento e o **cancelamento no fim do período**, depois **Save**.
7. Métodos de pagamento: **Settings → Payments → Payment methods**. O cartão chega para o teste. Para MB WAY ou Multibanco, confirme no painel se aparecem como compatíveis com **subscrições**. Nem todos os métodos portugueses suportam cobrança recorrente.

### 7. Programas no PC

- **Docker Desktop**: <https://www.docker.com/products/docker-desktop/>. Depois de instalar, abra-o e espere por "Engine running".
- Node e Go já estão instalados (são usados pelos testes do projeto).
- Opcional: a Stripe CLI, para ver os eventos em direto.

---

## Parte 2 — Por aplicação (repetir para cada aplicação)

Todos os comandos correm na pasta do projeto.

### 8. Segredos locais e chave de assinatura

```bash
node scripts/platform-secrets.mjs deployment/platform/.env
```

- Cria `deployment/platform/.env` a partir de `.env.example`, se ainda não existir.
- Preenche os valores gerados (`PLATFORM_DB_PASSWORD`, `PLATFORM_ENCRYPTION_KEY`, `PLATFORM_ADMIN_KEY`, `PLATFORM_SIGNING_KEY`) e grava a chave privada em `%USERPROFILE%\.foodtruck-platform\signing-key.pem`.
- Não mostra nenhum segredo e nunca substitui um valor que já exista.

Faça uma cópia de segurança de `.env` e de `signing-key.pem` num local seguro, como um gestor de palavras-passe ou um disco cifrado. Sem a chave de assinatura não é possível publicar atualizações.

### 9. Pacote assinado

```bash
npm run cloudflare:build
```

```bash
npm run cloudflare:package -- 1.0.0
```

```bash
go -C desktop/launcher run ./cmd/license-tool -mode sign-package -private-key "C:/Users/corsair/.foodtruck-platform/signing-key.pem" -package "E:/_desktop_2026/VibeCoding/_my_marketplace/food truck live/output/cloudflare/1.0.0"
```

(Noutro PC, troque `C:/Users/corsair` pela pasta do seu utilizador.)

→ `.env`: `PLATFORM_PACKAGE_HOST_PATH=E:/_desktop_2026/VibeCoding/_my_marketplace/food truck live/output/cloudflare/1.0.0` (use barras normais `/`).

Para cada versão nova, use um número novo (`1.0.1`…).

### 10. Completar o `.env`

Abra `deployment/platform/.env` e confirme que estão preenchidos todos os valores das secções Portal, Cloudflare, Email e Pagamentos. Ponha `PLATFORM_HOSTING_APPROVED=true`: é a autorização para criar recursos reais na sua conta Cloudflare. Mantenha `PLATFORM_TEARDOWN_APPROVED=false` até ao passo de remoção do teste final.

### 11. Arrancar o portal

```bash
docker compose --env-file deployment/platform/.env -f deployment/platform/compose.yaml --profile tunnel up --build -d
```

Em **Zero Trust → Networks → Tunnels**, o túnel `painel` deve aparecer como **Healthy**. Crie agora o webhook da Stripe (Parte 1, passo 6.5) e acrescente o `whsec_…` ao `.env`. Depois volte a correr o comando acima, para o serviço ler o valor novo.

### 12. Verificação prévia (obrigatória)

```bash
docker compose --env-file deployment/platform/.env -f deployment/platform/compose.yaml run --rm service -check
```

Cada linha mostra ✔ (certo), ! (aviso) ou ✘ (por resolver), com a causa em português. A verificação só faz consultas de leitura à Cloudflare, Brevo, Stripe, base de dados, pacote e portal, e nunca mostra segredos. **Não avance para o teste final enquanto houver ✘.**

Problemas frequentes:

| Mensagem | Causa provável |
|---|---|
| token inválido | O token foi copiado com espaços, expirou ou é de outra conta |
| Workers Paid | O plano não está ativo ou o token não tem Billing Read |
| zona … ainda não está ativa | Os nameservers ainda não mudaram no registrar |
| domínio … não está autenticado | Faltam registos DKIM/DMARC ou o proxy da Cloudflare está ligado nesses registos |
| não existe webhook para … | O URL do webhook não é exatamente `PLATFORM_ORIGIN/stripe/webhook` |
| responde HTTP 404/502/530 | O túnel está parado ou as rotas do passo 4 estão em falta ou trocadas |

### Tabela de variáveis (modelo para outras aplicações)

| Variável | Origem | Partilhada entre apps? |
|---|---|---|
| `PLATFORM_PUBLIC_HOST`, `PLATFORM_ORIGIN` | Rota do túnel (passo 4) | Não: um portal por aplicação (ex.: `instalar.`, `conta-app2.`) |
| `CLOUDFLARE_TUNNEL_TOKEN` | Passo 4 | Pode ser o mesmo túnel com mais rotas |
| `PLATFORM_DB_PASSWORD`, `…ENCRYPTION_KEY`, `…ADMIN_KEY` | Gerados (passo 8) | Não |
| `PLATFORM_SIGNING_KEY` | Gerado (passo 8) | Não: uma chave por produto |
| `PLATFORM_CLOUDFLARE_ACCOUNT`, `…TOKEN` | Passos 1 e 3 | Sim |
| `PLATFORM_SITE_DOMAIN`, `…ZONE_ID` | Passo 2 | Sim, ou um domínio por produto |
| `PLATFORM_PACKAGE_HOST_PATH` | Passo 9 | Não |
| `PLATFORM_BREVO_API_KEY` | Passo 5 | Sim |
| `PLATFORM_MAIL_FROM` | Passo 5 | Normalmente sim |
| `STRIPE_SECRET_KEY` | Passo 6 | Sim (a mesma conta Stripe) |
| `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` | Passo 6 | Não: um produto e um webhook por aplicação |

Depois disto, siga [`TESTE_FINAL.md`](TESTE_FINAL.md).

## Guia curto, com imagens

Para quem não é técnico, use o [guia interativo](guia-setup.html): 8 passos, cada um com capturas de ecrã reais da Cloudflare, do Brevo e do Stripe. Este documento fica como referência completa (inclui o modo com domínio próprio).

## Demonstração partilhada (opcional)

Depois da verificação `-check` sem erros, instale a demonstração uma vez:

```bash
go -C desktop/launcher run ./cmd/platform -demo-install -env ../../deployment/platform/.env
```

Corre a partir da raiz do projeto e precisa do Node. Cria um site demo com dados fictícios, sem subscrição, e escreve `PLATFORM_DEMO_CUSTOMER_URL` e `PLATFORM_DEMO_MANAGEMENT_URL` no `.env`. Reinicie o portal para aparecer o botão **Experimentar a demonstração**. Detalhes em [DEMO_PLAN.md](DEMO_PLAN.md).
