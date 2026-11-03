# Food Truck Live

Aplicação web em português (Portugal) para clientes, carrinhas e equipas. A versão atual usa **dois sites Next.js, uma API Node.js e PostgreSQL**. A instalação de referência combina Vercel, Supabase e Brevo; também existem receitas para Node.js/Docker e modelos opcionais Cloudflare Workers.

## Começar por aqui

- [Manual de utilização em PDF](docs/manuals/Manual_Food_Truck_Live_PT.pdf)
- [Manual detalhado de instalação em PDF](docs/manuals/Manual_Instalacao_Food_Truck_Live_PT.pdf)
- [Instalação: fonte editável e passos](docs/manuals/INSTALACAO_PT.md)
- [Utilização: fonte editável](docs/manuals/UTILIZACAO_PT.md)

Requisitos: Node.js 24, npm e PostgreSQL. Uma instalação nova não inclui contas nem dados operacionais de outra instalação.

```sh
npm ci --include=dev
npm run install:init
# Editar .env.install com as SUAS ligações e serviços.
npm run install:check
npm run db:migrate
npm run install:doctor
npm run db:bootstrap
npm run build:install
npm start
```

O bootstrap pede a primeira conta de administrador num terminal e recusa alterar uma base que já contém contas, organizações ou negócios. Em produção, configure HTTPS, email e armazenamento persistente. Para desenvolvimento, depois da configuração/migrações, use `npm run dev`. Sites: 3000 e 3001; API: 4000.

## Instalação e portabilidade

- **Vercel:** projetos separados com raízes `apps/customer`, `apps/management` e `services/api`; a API comunica com PostgreSQL e storage externos. Ver o manual para variáveis, migrações e o erro routes-manifest.
- **Docker:** `docker compose --env-file .env.install -f compose.install.yaml up -d --build`. Configure domínios/HTTPS e siga o manual para bootstrap dentro do contentor.
- **Cloudflare:** DNS/proxy à frente de Docker, ou preparação opcional dos sites Workers com `npm run cloudflare:prepare -- customer https://SUA-API.example.com` (repetir para management). O adaptador instala-se apenas quando escolhido; validar build/preview antes de deploy. A API continua em Node.js.
- **Base:** PostgreSQL próprio/gerido, incluindo Supabase. MySQL, SQLite e D1 requerem adaptação; não são trocas diretas.
- **Imagens:** disco persistente, bucket privado Supabase ou S3/R2. Email por Brevo API ou SMTP.

Os planos gratuitos têm limites e condições: Vercel Hobby é pessoal/não comercial. O manual compara planos com fontes e data de consulta. Nenhum comando de instalação compra planos ou copia a base online da referência.

## Manutenção e distribuição

`npm run backup` cria dump PostgreSQL e copia imagens locais; objetos de storage externo exigem cópia separada. Configure a ligação de migração e o esquema de backup, e ensaie restauros. Não use bootstrap numa atualização.

`npm run package:release` cria ZIP em `release/`, com código, recursos UPLOADS e manuais, excluindo segredos, base operacional e caches. Requer Git e Python 3. `npm run manuals:build` regenera PDFs a partir das fontes (ReportLab/Pillow e fontes Segoe UI ou DejaVu).

A gestão dispõe de opção Atual/Touch nas Encomendas, Menu digital, Página de encomendas e Inventário. A escolha é local ao navegador. A localização pública corresponde a pontos/eventos publicados, com próximas paragens identificadas; não é GPS contínuo.

## Verificação e histórico

`npm run typecheck` valida a API. Os testes de API devem usar base/esquema isolado; consulte `docs/TESTING.md`. Os testes e scripts legacy referem-se à versão SQLite anterior, não à instalação PostgreSQL. `docs/manuals/` é a referência atual de instalação e utilização; documentos históricos descrevem decisões anteriores.

O sistema não ativa pagamentos de cartão nem faturação fiscal certificada. Não publique passwords, dumps ou chaves API. Preserve UPLOADS: são recursos de conteúdo para uso manual.
