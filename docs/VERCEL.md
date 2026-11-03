# Publicação no Vercel

A referência atual e completa é o [manual de instalação](manuals/INSTALACAO_PT.md), também disponível em [PDF](manuals/Manual_Instalacao_Food_Truck_Live_PT.pdf). Este resumo refere-se à arquitetura PostgreSQL atual.

Crie três projetos ligados ao mesmo repositório GitHub:

| Projeto | Root Directory | Framework | Output |
| --- | --- | --- | --- |
| Clientes | apps/customer | Next.js | .next |
| Gestão | apps/management | Next.js | .next |
| API | services/api | Other, vercel.json incluído | Não usar .next |

Use Node.js 24. Nos sites, `npm run build` e `INTERNAL_API_URL` com URL HTTPS da API, em build e runtime. Preserve os workspaces e permita ficheiros partilhados fora da raiz da app quando necessário.

A API pode funcionar no Vercel com o handler HTTP `services/api/api/index.ts`. Use PostgreSQL externo e storage externo persistente; não precisa de um serviço pago Render. No Supabase serverless, use transaction pooler em execução, e ligação direta/session para instalar/migrar.

A API recebe segredos PostgreSQL, certificado TLS, storage e Brevo/SMTP, além de CUSTOMER_APP_URL, MANAGEMENT_APP_URL e CORS_ORIGINS. Os sites não recebem passwords ou chaves de servidor. Aplique migrações e crie o administrador com os comandos do manual antes do teste funcional.

Mudar INTERNAL_API_URL exige nova compilação/publicação dos sites. Mudar variáveis da API exige nova publicação da API. CORS deve conter os dois domínios finais. Não use a raiz geral do repositório como raiz dos sites.

O erro NEXT_NO_ROUTES_MANIFEST exige conferir a raiz, preset, output e logs do build da publicação em causa. Uma publicação antiga falhada continua a mostrar o erro depois de uma nova publicação ficar Ready.

Vercel Hobby tem condição de uso pessoal/não comercial. Consulte os preços e limites oficiais antes de usar profissionalmente. Os percursos Docker, Cloudflare e PostgreSQL alternativo estão explicados no novo manual.
