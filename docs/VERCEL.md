# Publicação no Vercel

A aplicação atual tem dois frontends Next.js e uma API Fastify com PostgreSQL. A pasta `app` na raiz contém a versão antiga baseada em SQLite local. Não usar a raiz do repositório como Root Directory do projeto Vercel.

## Preparar o servidor

A API precisa de um serviço Node.js persistente, do worker de manutenção e de uma base PostgreSQL. O Vercel dos frontends não inicia `scripts/dev-network.mjs` nem os serviços locais do computador.

O modelo de alojamento completo existente está em `compose.network.yaml`; ver [CONNECTED_APPS.md](CONNECTED_APPS.md). Configurar armazenamento persistente para uploads ou S3, aplicar as migrações e criar o administrador antes de publicar. Os dados locais e os uploads da base em `data/` não são enviados pelo Git; devem ser migrados separadamente para o alojamento escolhido.

Confirmar que `https://<api>/api/v1/health` responde com `{"ok":true}`. A API deve ter HTTPS e ser acessível pelo servidor do Vercel. Usar as URLs públicas reais em CUSTOMER_APP_URL, MANAGEMENT_APP_URL e CORS_ORIGINS da API. Não colocar DATABASE_URL ou credenciais em variáveis NEXT_PUBLIC_*.

## Projetos Vercel

Criar dois projetos a partir do mesmo repositório, ambos com framework Next.js e branch de produção `master`:

| Configuração | Menus dos clientes | Gestão |
| --- | --- | --- |
| Root Directory | `apps/customer` | `apps/management` |
| Build Command | `npm run build` | `npm run build` |
| Output Directory | valor predefinido do Next.js | valor predefinido do Next.js |
| INTERNAL_API_URL | URL HTTPS da API, sem barra final | mesma URL |
| CUSTOMER_APP_URL | URL pública dos clientes | URL pública dos clientes |
| MANAGEMENT_APP_URL | URL pública da gestão | URL pública da gestão |

Permitir acesso aos ficheiros fora da Root Directory para resolver o workspace e o package-lock da raiz. Usar Node.js 24 e a instalação npm com o lockfile do repositório. As reescritas `/api/v1/*` e `/uploads/*` usam INTERNAL_API_URL durante o build; depois de alterar esta variável, fazer um novo deploy.

Não usar `http://localhost:4000` no Vercel: esse endereço refere-se ao próprio ambiente remoto. Sem uma API alojada, os frontends não conseguem carregar negócios, autenticar utilizadores nem criar encomendas.

## Verificar a publicação

Abrir `/api/v1/health` através de cada domínio frontend, carregar o catálogo e uma imagem de upload, iniciar sessão e confirmar as atualizações de encomendas. Consultar os Runtime Logs do Vercel para exceções do servidor; uma resposta HTTP 200 da página pode ainda conter a interface de erro do Next.js.

Referência: https://vercel.com/docs/monorepos
