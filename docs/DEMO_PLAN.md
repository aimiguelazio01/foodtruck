# Plano: demonstração partilhada e limitada

Objetivo: quem compra (ou quer comprar) a aplicação pode experimentá-la já com dados de exemplo, com um utilizador de demonstração, sem pagamentos reais e sem poder estragar nada.

Decisões (2026-11-05): um único site demo partilhado, criado uma vez na conta Cloudflare do operador; o visitante pode explorar e editar um pouco; sem pagamentos, sem emails reais, sem mudar definições da conta; os dados repõem-se sozinhos.

## O que já existe (reaproveitar)
- `deployment/demo/fixture.json`: 3 negócios, 30 produtos, 72 encomendas, stock, eventos, tarefas (fictício).
- `services/api/scripts/seed-demo.ts`: carrega a fixture para PostgreSQL, desloca as datas para "agora", cria o utilizador `owner@urban-burger.demo` e a rede `demo-network`, e marca `installation_state.mode='demo'`.
- `services/api/src/installation.ts` (versão PostgreSQL): `DEMO_MODE`, `/api/v1/demo/session` (sessão sem palavra-passe) e `Demonstração — apenas consulta`.
- A migração `016_installation.sql` já aceita `mode IN ('demo','system')`.
- Falta tudo isto nos Workers: `installation-worker.mjs` devolve `demo:false` fixo.

## Fases

**Fase 1: modo demo nos Workers** (`deployment/cloudflare`) — FEITA (2026-11-05): `demo-mode.mjs`, ligada em `api-worker.mjs`, `installation-worker.mjs` e `mail.mjs`; testes em `demo-mode.test.mjs` (59 testes Cloudflare passam).
1. Variável `DEMO_MODE=1` no API Worker. O estado da instalação passa a dizer `demo:true`.
2. `POST /api/v1/demo/session`: cria sessão do utilizador demo (só com `Origin` da gestão, com limite de pedidos). Só existe com `DEMO_MODE`.
3. Travões em demo: sem alterações de empresa/marca/imagens, sem rota de pagamento real, sem emails (contas de cliente e recuperações), sem criar utilizadores. Produtos e estado de encomendas continuam editáveis.
4. Testes: a rota não existe sem `DEMO_MODE`; cada travão devolve 403.

**Fase 2: dados e reposição** — FEITA (2026-11-05), salvo as imagens: `deployment/demo/seed-d1.mjs` (fixture → SQL), `deployment/demo/build-seed-package.mjs` (fixture + colunas reais das migrações, para `demo/fixture.json` no R2 do site demo), `deployment/cloudflare/demo-reset.mjs` (reposição no cron, no máximo uma vez por dia) e `demo-reset.test.mjs`. Os utilizadores, negócios e a rede demo nunca são apagados (o trigger do D1 proíbe remover o último dono), só atualizados. As imagens dos produtos ficam para a Fase 3 (a fixture não referencia imagens).
1. `deployment/demo/build-d1-seed.mjs`: aplica as migrações a um SQLite temporário, descobre as colunas, converte a fixture em SQL para D1 (datas deslocadas, palavra-passe do demo, rede `demo-network`).
2. Reposição diária: o `scheduled` do Worker, em demo, apaga as tabelas de dados e volta a carregar o SQL, em lotes (limites do D1).
3. Imagens: reutilizar as dos produtos de demonstração em R2 (a verificar o que a fixture referencia).

**Fase 3: instalar o demo uma vez** — FEITA (2026-11-05): `platform -demo-install -env deployment/platform/.env` (corre a partir da raiz do projeto, precisa do Node). Instalou na conta real e carregou 949 instruções de dados. Endereços em `PLATFORM_DEMO_CUSTOMER_URL` e `PLATFORM_DEMO_MANAGEMENT_URL`. O token de carga deriva da chave de assinatura; voltar a correr o comando retoma o mesmo diário (a mesma versão do pacote).
1. Comando de operador (`platform -demo-install`) que corre o fluxo normal de instalação com `DEMO_MODE=1`, sem subscrição nem webhook, e guarda os dois endereços.
2. A verificação do instalador hoje recusa `demo:true`: aceitar só neste comando.

**Fase 4: portal** — FEITA (2026-11-05): `apps/portal/app/api/demo/route.ts` + `demoLinks()` em `lib.ts` (teste `demo.test.ts`), bloco "Quer ver como funciona primeiro?" em `page.tsx`, variáveis no `compose.yaml` e no `.env.example`. A gestão já tinha `/demo` (entra sozinha) e a faixa de demonstração. Achado: a gestão da rede mostra "Página não encontrada" porque o API dos Workers não implementa `/network/<org>`, `availability`, `shifts`, `templates` e `transfers`; afeta todas as instalações Cloudflare, não só a demo.
1. `PLATFORM_DEMO_CUSTOMER_URL` e `PLATFORM_DEMO_MANAGEMENT_URL` no `.env`.
2. Botão **Experimentar a demonstração** no painel (antes e depois de criar conta), com a etiqueta "dados fictícios, sem pagamentos".
3. A página de gestão demo entra sozinha (chama `/demo/session`) e mostra uma faixa "Demonstração".

**Fase 5: guia e TESTE_FINAL** — FEITA (2026-11-05): `docs/guia-setup.html` reescrito (8 passos, 11 capturas reais, sem campos para segredos), `docs/TESTE_FINAL.md` com o resultado do teste real e a secção da demo, `docs/SETUP_REAL.md` com a demo. Capturas em `docs/img/` (o email do operador foi tapado; nunca guardar a página de chaves do Stripe).

## Riscos
- O esquema D1 evoluiu (redes, organizações): a fixture antiga precisa de mapeamento, como faz o `seed-demo.ts`.
- Um site partilhado e editável pode receber lixo: por isso a reposição diária e os limites de pedidos.
- A demo gasta a quota do Workers Paid (insignificante com tráfego baixo).
