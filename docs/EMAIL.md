# Emails de confirmação e recuperação

> **Percurso alternativo.** Este documento descreve o envio de email da API Node (Brevo ou SMTP), para instalações próprias ou avançadas. No alojamento gerido, configurado pelo portal de instalação (ver [deployment/platform/README.md](../deployment/platform/README.md)), o operador envia o email de contas e de recuperação com uma única conta Brevo da plataforma (`PLATFORM_BREVO_API_KEY`, `PLATFORM_MAIL_FROM`); o cliente não configura nada.

A API suporta Brevo por HTTPS (`BREVO_API_KEY`) ou um servidor SMTP (`SMTP_URL`). O remetente é definido em `MAIL_FROM`. Não guardar as credenciais no Git nem em variáveis NEXT_PUBLIC_*.

## Brevo gratuito

1. Criar uma conta gratuita em https://onboarding.brevo.com/account/register e confirmar o email da conta.
2. Adicionar e verificar o remetente nas definições de senders. A aprovação do envio transacional deve estar concluída.
3. Em SMTP & API → API Keys, gerar uma chave de API. Uma chave SMTP não serve para a integração HTTP.
4. Nas variáveis do projeto Vercel **foodtruck-api**, adicionar `BREVO_API_KEY` como segredo para Production. `MAIL_FROM` deve corresponder ao remetente verificado.
5. Fazer novo deploy da API; alterações de variáveis não afetam publicações antigas.
6. Na conta de cliente, introduzir o email e escolher **Reenviar confirmação**. A ligação anterior fica inválida. Consultar os registos transacionais do Brevo e confirmar a receção na caixa de correio/spam.

O plano Free inclui até 300 emails por dia. Endereços gratuitos, como Gmail, podem ser reescritos pelo Brevo para um domínio de envio do fornecedor. Um domínio próprio autenticado melhora a identificação do remetente, mas não é necessário adquirir um domínio para começar com um remetente gratuito verificado.

## Comportamento da aplicação

- Em produção sem serviço configurado, registo, reenvio e recuperação devolvem um erro explícito. Não é apresentado sucesso de envio nem criada uma nova conta pendente por essa tentativa.
- Contas pendentes existentes são preservadas e podem pedir outro email quando o serviço for configurado. A confirmação continua obrigatória.
- O reenvio tem limites por IP e por email e usa resposta genérica para emails inexistentes ou já confirmados.
- Emails em português contêm a ligação de confirmação/recuperação. Tokens não são devolvidos no browser nem registados nos logs.
- Em desenvolvimento sem fornecedor, a caixa de saída local continua disponível para testes. Nunca é usada como substituto de entrega em produção.
- Testes de integração mockam o Brevo e não enviam emails externos.

Referências: https://developers.brevo.com/docs/send-a-transactional-email e https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans
