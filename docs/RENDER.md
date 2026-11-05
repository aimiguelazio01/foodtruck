# Alojamento gratuito: Render + Supabase

`render.yaml` configura uma única API no plano **free**, sem discos, base Render ou worker pagos. PostgreSQL e imagens ficam no Supabase Free. Não aplicar versões antigas deste Blueprint, que continham recursos pagos.

- API: `npm ci --include=dev --no-audit --no-fund && npm run build --workspace=@foodtruck/api`.
- Arranque: `node scripts/render-start.mjs api`.
- `RUN_MAINTENANCE=1` executa a manutenção dentro da API enquanto está ativa. Durante suspensão do Render não há manutenção periódica; retoma ao arrancar.
- `DATABASE_URL`: pooler **session mode**, porta 5432, utilizador exclusivo da aplicação, TLS `sslmode=verify-full`. O modo transaction não suporta o LISTEN/NOTIFY usado pela aplicação.
- `NODE_EXTRA_CA_CERTS=services/api/certs/supabase.crt`: certificado público oficial Supabase para verificar TLS, também utilizado nas migrações.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET=foodtruck-media`: armazenamento persistente num bucket privado. A chave de servidor fica apenas na API; nunca no browser ou no Git.
- `CUSTOMER_APP_URL`, `MANAGEMENT_APP_URL`, `CORS_ORIGINS`: URLs reais dos frontends.

O esquema `foodtruck` fica separado das tabelas públicas do Supabase e sem acesso para anon/authenticated. As contas continuam a ser geridas pela API existente; não são contas Supabase Auth.

As migrações são automáticas e usam advisory lock. Para transferir a instalação local, copiar os dados na ordem das dependências e enviar as imagens de `data/uploads` para o bucket mantendo os nomes. Preservar os conteúdos manuais de `UPLOADS`.

O Render Free suspende a API após 15 minutos sem tráfego. O primeiro acesso pode demorar. Supabase Free pode pausar o projeto após inatividade e tem limites de armazenamento e tráfego. SMTP externo não está configurado: recuperação e verificação continuam no outbox privado; em armazenamento efémero não se deve contar com retenção desses ficheiros entre reinícios.

Depois de a API responder em `/api/v1/health`, definir `INTERNAL_API_URL` nos projetos Vercel e voltar a publicar. Ver [VERCEL.md](VERCEL.md).

Referências: https://render.com/docs/free e https://supabase.com/pricing

> **Percurso alternativo.** A oferta principal é o alojamento gerido na Cloudflare, configurado pelo portal de instalação (ver [deployment/platform/README.md](../deployment/platform/README.md)). Este documento descreve a publicação em Render + Supabase e mantém-se para instalações próprias ou avançadas; não é necessário para clientes do alojamento gerido.

