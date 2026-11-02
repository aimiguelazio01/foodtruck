# Publicação gratuita atualmente configurada

- Clientes: https://foodtruck-swart.vercel.app (`apps/customer`).
- API: https://foodtruck-api.vercel.app (`services/api`).
- PostgreSQL e imagens privadas: projeto Supabase `yyzyjscbeurqvkulnepl`, plano Free.
- Não foi criado nenhum serviço pago no Render. O Render bloqueou a criação gratuita por exigir dados de pagamento; a API foi alojada no Vercel.

A API usa uma função HTTP explícita em `services/api/api/index.ts`. O certificado público Supabase é passado na variável cifrada `DATABASE_CA_CERT_PEM`, mantendo a verificação TLS. `DATABASE_URL` usa o pooler transacional (porta 6543) para evitar o limite de ligações por sessão. As migrações e cópias usam o pooler session (5432), pois precisam de ligações estáveis e advisory locks.

O esquema `foodtruck` pertence ao utilizador exclusivo `foodtruck_app` e não está exposto aos papéis anon/authenticated do Supabase. As contas da aplicação continuam a ser geridas pela API existente; não são contas Supabase Auth. Nunca usar as credenciais de servidor no frontend.

O bucket `foodtruck-media` é privado. `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `SUPABASE_STORAGE_BUCKET` ficam apenas no projeto Vercel da API. O frontend usa `INTERNAL_API_URL=https://foodtruck-api.vercel.app` e as reescritas habituais para `/api/v1` e `/uploads`.

Os dados locais foram copiados com autorização do utilizador: 38 tabelas, 1121 registos e 48 imagens. Sessões de login e códigos de recuperação/verificação temporários não foram copiados. A base e as imagens locais foram preservadas. Não repetir a cópia sobre a instalação online já usada sem reconciliar os dados.

No Vercel, a API anuncia `X-Foodtruck-Updates: poll` e desativa streams permanentes com HTTP 204. Os menus e a gestão atualizam os dados a cada 15 segundos; tracking e conta já tinham atualização periódica. A manutenção de reservas/sessões corre no início de pedidos, no máximo uma vez por minuto por instância. Não existe worker permanentemente ativo ou cron pago. Fora do Vercel, o servidor mantém o modo LISTEN/NOTIFY e o worker separado.

Não há SMTP externo configurado. Recuperação e verificação por email dependem dessa integração; o outbox em disco efémero do Vercel não fornece entrega de email nem retenção persistente.

Os planos gratuitos têm limites de utilização e o Supabase pode pausar projetos inativos. O Vercel Hobby destina-se a utilização pessoal e não comercial; rever os termos antes de usar esta instalação num negócio real.

Referências: https://supabase.com/pricing e https://vercel.com/docs/plans/hobby
