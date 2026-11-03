# Validação da preparação de instalação - 03.11.2026

- API: typecheck e compilação TypeScript aprovados.
- Instalação: migrações numa base/esquema temporário, reaplicação idempotente, bootstrap, hash da palavra-passe, recusa de repetição e ausência de negócios demo aprovados (`npm run test:install`).
- Regressão: testes de checkout/stock/capacidade/pagamento e contas de cliente/verificação/associação/recuperação aprovados (`npm run test:api`).
- Compose: YAML, serviços e volumes validados. Execução Docker não testada porque Docker não está disponível neste computador.
- Cloudflare Workers: modelos e preparação opcional incluídos, segundo a documentação OpenNext. Não foi instalada/configurada uma conta Cloudflare nem feita publicação; validar build/preview na plataforma escolhida. A API continua a exigir Node.js.
- PDFs: 16 páginas de utilização e 26 de instalação; todas as páginas renderizadas para revisão, índice final revisto, extração de texto, links e marcadores verificados.
- ZIP: integridade, caminhos, exclusão de dados operacionais/segredos e igualdade SHA-256 dos 42 recursos UPLOADS verificadas. Os manuais são incluídos no pacote.

Não foram copiados dados operacionais para o pacote, não foi criada uma conta no serviço online e nenhum plano pago foi ativado. A configuração de referência Vercel/Supabase/Brevo mantém os seus segredos apenas nos serviços existentes.
