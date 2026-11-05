# Portal de instalação — estado da implementação

## Alojamento gerido autoatendido (estado atual)

O caminho principal para clientes sem conhecimentos técnicos: o cliente cria conta no portal, experimenta grátis e subscreve; o site corre na conta Cloudflare **do operador** (Workers + D1 + R2) num endereço do domínio do operador. Não há conta Cloudflare, token, licença, Supabase ou Brevo do lado do cliente. O texto histórico do piloto segue abaixo; onde diferir, vale esta secção.

Implementado e testado com Cloudflare, Stripe e Brevo **simulados** (nada foi executado contra serviços reais):

- **Registo e teste gratuito:** `POST /auth/signup` (email + palavra-passe, confirmação por email) e `POST /auth/verify` (inicia um teste por conta, `PLATFORM_TRIAL_DAYS`, por omissão 14, e abre sessão). Contas por confirmar não iniciam sessão.
- **Endereços próprios:** `PLATFORM_SITE_DOMAIN` + `PLATFORM_SITE_ZONE_ID` colocam o site em `<nome>.<domínio>` e a gestão em `<nome>-gestao.<domínio>`. O nome é validado, reservado por encomenda (`portal_slugs`) e verificado em `GET /slugs/check`. Encomendas antigas mantêm workers.dev.
- **Pagamentos Stripe:** `POST /billing/checkout`, `POST /billing/portal` e `POST /stripe/webhook` (assinatura verificada, eventos idempotentes). `invoice.paid` prolonga o período pago mais 3 dias; falha de pagamento marca `past_due` sem cortar o período pago. Variáveis: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`. O Caddy entrega `/stripe/webhook` diretamente ao serviço Go.
- **Email da plataforma:** `PLATFORM_BREVO_API_KEY` + `PLATFORM_MAIL_FROM`. A mesma chave e remetente são injetados em cada API Worker (`BREVO_API_KEY`, `MAIL_FROM`) para verificação de conta e recuperação de palavra-passe. Atenção: a chave fica em cada Worker; rodá-la exige republicar todos.
- **Ciclo de vida** (`platform/lifecycle.go`, a cada 10 minutos): lembretes de fim de teste (3 dias e 1 dia), suspensão ao terminar o período, retenção (`PLATFORM_RETENTION_DAYS`, 30), cópia final com imagens e remoção só depois de existir cópia posterior à suspensão. Encomendas simuladas criadas pelo operador nunca são suspensas nem removidas.
- **Remoção** (`cloudflare/teardown.go`): endereços, Workers, base D1 e bucket R2, cada um confirmado contra a identidade registada na instalação. As imagens são apagadas por regra de expiração de um dia, e o bucket é removido numa passagem seguinte. **Desativada por omissão:** `PLATFORM_TEARDOWN_APPROVED=true` só depois de testar um restauro.
- **Capacidade:** `PLATFORM_MAX_INSTALLATIONS` (0 = sem limite) recusa novas instalações com mensagem clara; repetir uma instalação já aceite não é bloqueado.
- **Barreira de alojamento no Worker:** estado em memória 5 min (suspenso 1 min) e guardado em D1 (migração `023_hosting_status`); se o portal falhar, um site confirmado ativo nas últimas 72 h continua a servir. Nunca desbloqueia um site suspenso ou desconhecido. Instalações anteriores à migração não têm o estado guardado até serem republicadas.
- **Portal:** `/` é um assistente em quatro passos (conta, negócio, progresso automático, pronto com QR e subscrição); `/avancado` mantém o fluxo antigo (código de compra, conta Cloudflare própria, backups e validações); `/admin` mostra estado do plano e fim de teste.

**Montagem real:** guia passo a passo das contas (Cloudflare, domínio, túnel, Brevo, Stripe) em [`docs/SETUP_REAL.md`](../../docs/SETUP_REAL.md) e checklist de aceitação em [`docs/TESTE_FINAL.md`](../../docs/TESTE_FINAL.md). `node scripts/platform-secrets.mjs` gera os segredos locais e a chave de assinatura. `docker compose … --profile tunnel up` publica o portal a partir de um PC por Cloudflare Tunnel, e `--profile public` usa o Caddy num servidor. `docker compose … run --rm service -check` confirma a configuração real só com consultas de leitura, sem mostrar segredos.

Ainda por verificar ou fazer:

- Primeira instalação real numa conta Cloudflare Workers Paid, incluindo as causas do HTTP 503 e o tempo de CPU do início de sessão (PBKDF2 a 600 000 iterações).
  Para diagnosticar, correr `npx wrangler tail <worker-da-api> --format json` durante o teste. Cada 503 (erro não tratado,
  verificação do alojamento, instalação, imagens) deixa uma linha JSON `"event":"api-error"` com `route` (método e caminho
  com identificadores trocados por `:param`, sem query), `stage` (`hosting-gate`, `backend`, `worker-route`, `staff-auth`,
  `account-route`, `installation:password`…), `error`, `message` (até 200 caracteres, sem URLs, emails nem tokens),
  `requestId` (igual ao `errorId` devolvido ao cliente) e `ray`. Cada início de sessão de equipa ou cliente deixa
  `"event":"pbkdf2"` com `kind`, `impl` (`webcrypto` ou `noble`, a alternativa quando o limite de iterações é imposto) e
  `durationMs`. Nos Workers o relógio só avança com I/O: um `durationMs` de 0 não significa custo zero, usar então o
  tempo de CPU do evento do tail. Nenhuma linha leva corpos, cookies, emails, palavras-passe nem tokens.
- Chamadas à API Cloudflare escritas de memória: domínios de Workers (`/workers/domains`) e regra de ciclo de vida do R2 (`/r2/buckets/{nome}/lifecycle`). Confirmar na documentação atual.
- Formato dos eventos Stripe (tratados nos formatos antigo e novo da fatura), em modo de teste com `stripe listen`.
- Domínio, DNS, certificados, servidor, chaves e Brevo com domínio do remetente autenticado (SPF/DKIM).
- Termos de serviço, política de privacidade e faturação certificada (IVA) não existem.
- Limites reais de Workers/D1 por conta Cloudflare: definir `PLATFORM_MAX_INSTALLATIONS` a partir deles. Acima dos limites, avaliar Workers for Platforms.
- Alertas ao operador (cópias finais que falham, remoções pendentes), limpeza das cópias de validação de restauro e email de confirmação de remoção.
- Ainda só em Node: exportações Excel/CSV, eventos recorrentes e escala da rede nos sites Cloudflare.

Testes: `npm run cloudflare:test`, `npm run test:shared`, `go -C desktop/launcher test ./...` (testes do serviço exigem PostgreSQL: `node scripts/with-test-postgres.mjs scripts/test-platform.mjs`) e `npm run build --workspace=@foodtruck/portal`. O fluxo corre em `.github/workflows/platform.yml`.

## Histórico do piloto

Implementados: serviço Go, esquema PostgreSQL separado, emissão administrativa
de compras simuladas, códigos de acesso guardados por hash, consulta isolada por
cliente, registo idempotente de instalação, payload cifrado AES-GCM associado à
tarefa, executor exclusivo PostgreSQL e integração com o motor Cloudflare existente.
O portal Next permite consultar compras, configurar o negócio e acompanhar o estado.

Esta entrega ainda não conclui o plano. Não usar como serviço comercial.
O portal `/admin` emite e consulta compras simuladas. Tarefas bloqueadas ou
canceladas podem ser retomadas; tarefas em fila podem ser canceladas sem apagar
recursos. As operações são auditadas. Uma publicação em curso impede estas ações
até terminar a sua operação; não é interrompida a meio de uma alteração cloud.

O início/callback OAuth usa PKCE S256, cookie HttpOnly, estado de utilização única
com validade de dez minutos e token cifrado no servidor. A autorização permite consultar contas e selecionar a conta de instalação. O servidor
valida a conta na criação da tarefa e novamente antes da execução. A associação não
pode mudar depois de a tarefa ser registada. O executor utiliza as credenciais do
cliente apenas na modalidade de conta própria; a subscrição utiliza as credenciais
da plataforma. Tokens com menos de quinze minutos de validade exigem nova ligação.

A integração está ligada ao motor real, mas não foi publicada com OAuth real.
Continuam pendentes renovação/revogação automática do token, contas/sessões do
portal, validação real da verificação de plano, logótipos, evolução do ciclo de
subscrição, backups e restauro. A aprovação do alojamento continua a exigir ação
do operador antes de o executor criar recursos reais.

## OAuth Cloudflare

Configurar `PLATFORM_OAUTH_CLIENT_ID`, `PLATFORM_OAUTH_CLIENT_SECRET` (para cliente
confidencial) e `PLATFORM_OAUTH_SCOPES` com os scopes efetivamente registados no
cliente. Registar o redirect exato `PLATFORM_ORIGIN/api/oauth/callback`.
Usar HTTPS no ambiente publicado. Clientes públicos exigem domínio verificado;
um cliente privado só permite o teste com membros da conta que o criou.
As credenciais não devem usar prefixo NEXT_PUBLIC nem integrar o build do portal.

Testes OAuth usam transporte HTTP simulado e PostgreSQL local real. Validam PKCE,
ligação ao navegador, rejeição de replay e persistência cifrada; não provam uma
autorização real da Cloudflare. Referência oficial:
https://developers.cloudflare.com/fundamentals/oauth/integrate-with-cloudflare/

## Executar em desenvolvimento

Configurar no serviço Go:

- `PLATFORM_DATABASE_URL`: PostgreSQL exclusivo da plataforma.
- `PLATFORM_ENCRYPTION_KEY`: 32 bytes aleatórios em base64url sem padding.
- `PLATFORM_ADMIN_KEY`: segredo aleatório com pelo menos 32 caracteres.
- `PLATFORM_ORIGIN`: origem do portal, por exemplo `http://localhost:4200`.
- `PLATFORM_LISTEN`: por defeito `127.0.0.1:4100`.

Iniciar `go -C desktop/launcher run ./cmd/platform` e
`npm run dev --workspace=@foodtruck/portal`. O portal utiliza
`PLATFORM_INTERNAL_URL` (por defeito `http://127.0.0.1:4100`) no servidor.
Não expor o serviço Go diretamente à Internet.

Uma chamada administrativa `POST /admin/orders`, com Authorization Bearer e Origin,
recebe `{ "name": "Cliente de teste", "mode": "platform" }` e devolve o código de
acesso uma única vez. A conta própria usa `mode: customer`.

## Publicação real

Sem configuração de alojamento, a tarefa termina bloqueada e não cria recursos.
Para usar o executor real são necessários `PLATFORM_HOSTING_APPROVED=true`,
`PLATFORM_CLOUDFLARE_ACCOUNT`, `PLATFORM_CLOUDFLARE_TOKEN`,
`PLATFORM_SIGNING_KEY` (chave privada Ed25519 de 64 bytes, base64url),
`PLATFORM_PACKAGE_DIRECTORY` (pacote assinado com a chave correspondente) e
`PLATFORM_JOURNAL_DIRECTORY` (volume persistente). A aprovação é configuração
do operador; não constitui verificação automática de plano Paid. Não colocar estes
valores em código, logs ou no portal. Ainda é preciso validar o login em Workers Paid.

## Testes

`go -C desktop/launcher test ./...` verifica testes unitários; o teste PostgreSQL
é omitido se não existir DATABASE_URL. Para executar com base descartável:
`node scripts/with-test-postgres.mjs scripts/test-platform.mjs`.

## Seleção de conta e recuperação

Depois de autorizar a Cloudflare, voltar ao portal, introduzir o código de acesso,
consultar as compras e carregar em Consultar contas autorizadas. Selecionar a conta
e preencher o negócio. A publicação exige os mesmos pré-requisitos de pacote
assinado, chaves e volume de progresso da modalidade gerida. Os tokens OAuth nunca
são enviados ao navegador nem incluídos no payload da tarefa.

Uma autorização expirada bloqueia a tarefa com uma mensagem de recuperação.
Voltar a ligar a mesma conta e escolher Retomar. Uma alteração de token durante
um upload de resultado incerto pode exigir recuperação adicional do journal;
não apagar o journal nem mudar de conta para contornar a proteção de propriedade.

Testes PostgreSQL cobrem conta não autorizada, associação imutável após enqueue,
ausência/expiração de token e resolução das credenciais a partir da compra.

## Subscrições geridas

O operador pode cancelar no fim do período e reativar subscrições simuladas em
`/admin`. O cliente também dispõe da operação `POST /subscriptions/action` para
cancelar a sua subscrição. Reativar é exclusivo do operador neste piloto. Uma
reativação de período expirado atribui trinta dias de teste; não cobra pagamentos.

Novas instalações geridas recebem uma credencial de alojamento exclusiva, cifrada
na base central e publicada como segredo no Worker da API. Cada pedido à API
consulta `/api/hosting/status` no portal por HTTPS. Uma subscrição expirada devolve
402; indisponibilidade do portal devolve 503. A manutenção não executa durante a
suspensão. Dados e recursos são preservados. Não existe cache nem período de graça:
a disponibilidade do portal central é necessária para estas instalações geridas.
Compras na conta do cliente não recebem estes bindings e continuam independentes.

O pacote publicado anteriormente não contém esta verificação. É necessário gerar
e assinar uma nova versão e validar uma nova instalação; esta alteração não atualiza
nem suspende automaticamente instalações antigas. O teste real continua pendente.

## Docker

Os Dockerfiles copiam apenas as fontes necessárias ao serviço e ao portal.
`compose.yaml` mantém PostgreSQL e journals em volumes, usa pacote assinado read-only
e só publica o portal em `127.0.0.1:4200`. O serviço Go e a base não expõem portas.
Configurar os valores de ambiente num `.env` privado junto ao compose. Não versionar
esse ficheiro. `PLATFORM_DB_PASSWORD` deve ser seguro para utilização numa URL
(por exemplo, hexadecimal aleatório). `PLATFORM_PACKAGE_HOST_PATH` é a pasta
absoluta do pacote assinado. Executar pelo operador:

`docker compose --env-file deployment/platform/.env -f deployment/platform/compose.yaml up --build -d`

Um reverse proxy HTTPS e o domínio público precisam de estar configurados antes
de publicar instalações geridas. O cliente não configura estes serviços; são
pré-requisitos únicos do operador da plataforma. O build standalone Next passou;
as imagens Docker e o reverse proxy ainda precisam de validação real.

## Backup SQL do piloto

Uma instalação pronta permite agendar e consultar backups SQL no portal. O pedido
é validado contra o titular da compra e a fila evita duas exportações simultâneas
da mesma instalação. O executor partilha a exclusão de tarefas com a publicação,
verifica a tag de propriedade do Worker e mantém o journal bloqueado durante a
exportação oficial D1. A exportação pode suspender brevemente consultas D1.

O download presigned não recebe o token Cloudflare; só aceita HTTPS em hosts
cloudflarestorage.com, sem redirects. O limite deste piloto é 32 MiB por exportação.
Os ficheiros SQL são cifrados com AES-GCM por identificador do backup e guardados
no PostgreSQL central, com checksum SHA-256 e bookmark. A interface recebe apenas
metadados. Não há descarga de SQL, substituição da base em uso, cópia de imagens R2 ou retenção
automática nesta fase. Não considerar esta funcionalidade um backup completo da
aplicação. Proteger também o PostgreSQL central e a respetiva chave de cifra.

Tokens expirados ou subscrições fora do período podem impedir o executor de obter
credenciais para exportar; os dados existentes não são apagados. Um backup falhado
pode ser novamente pedido. Após reinício, uma exportação em curso volta a ser
solicitada e reconciliada pelo mecanismo oficial; a falha é registada se não puder
ser confirmada. Ainda falta validar este fluxo numa conta Cloudflare real.

Referência: https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/

## Validação de restauro numa cópia D1

O portal permite selecionar o backup SQL pronto mais recente e pedir a sua
validação numa base separada, com confirmação explícita de criação de recursos e
custos. A fila valida o titular do backup, permite uma validação por backup e guarda
o progresso. O resultado e o identificador da cópia podem ser consultados no portal.

O motor verifica o checksum SHA-256 antes de criar recursos, confirma a propriedade
do Worker de origem e cria uma base `foodtruck-restore-*`. Utiliza as operações
oficiais `init`, upload presigned, `ingest` e `poll`. O upload não recebe o token da
API. Após importar, verifica `quick_check`, `foreign_key_check` e o recibo bootstrap
da instalação. Não altera a base de origem nem os bindings dos sites/API.

Criação e importação têm intenções persistidas antes da chamada. Se a resposta de
criação se perder, ou se a importação começar sem ser possível guardar o bookmark,
o processo falha exigindo recuperação pelo operador. Não apaga nem repete essas
operações automaticamente. Um restauro em curso com bookmark guardado pode retomar
o polling após reinício. As cópias ficam preservadas e podem ter custos; ainda falta
o percurso de limpeza com confirmação. Os testes utilizam Cloudflare simulada e
PostgreSQL real local; não houve uma importação real neste desenvolvimento.

`verified` significa que a cópia passou estas verificações SQL; não significa que
foi ligada à aplicação nem que todos os percursos funcionais foram testados. Ainda
faltam compatibilidade de versão de esquema/pacote, ensaio funcional numa aplicação
isolada e o percurso de substituição com backup prévio, confirmação e rollback.
O backup/restauro de imagens R2 continua pendente.

Referência: https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/import/

## Verificação prévia de alojamento e progresso

O botão Verificar alojamento consulta subscrições da conta e o acesso de leitura a
D1, R2 e Workers. O executor repete a verificação antes de criar os recursos da
instalação. A aprovação de custos do operador continua necessária, mas não substitui
esta consulta automática. O token/OAuth precisa de permitir leitura da faturação.

O piloto só reconhece `WORKERS_PAID` em estado Paid ou Provisioned. Outros contratos,
Enterprise e identificadores não reconhecidos exigem revisão do operador; não são
classificados como compatíveis automaticamente. Esta verificação não demonstra
permissões de escrita, quotas restantes, latência ou consumo de CPU do login.
Nenhuma subscrição é contratada automaticamente nem são enviadas alterações de
faturação. Os testes desta verificação usam respostas Cloudflare simuladas.

As etapas reais do motor ficam guardadas no campo step da tarefa e aparecem no
portal: pacote, armazenamento, configuração inicial, API, encomendas, gestão e
verificação final. Uma falha na persistência da etapa interrompe a publicação antes
da operação seguinte. O botão Atualizar progresso lê o estado persistido; não há
percentagens ou temporizadores a simular o avanço.

Referências oficiais:
https://developers.cloudflare.com/api/resources/accounts/subresources/subscriptions/methods/get/
https://developers.cloudflare.com/tenant/reference/subscriptions/

## Backup opcional das imagens R2

Autorizado pelo proprietário da plataforma: a opção SQL + imagens copia os uploads
R2 da instalação para o PostgreSQL central da plataforma, de forma cifrada. O
portal exige confirmação explícita deste destino em cada pedido. A opção SQL
simples mantém `include_media=false` e não lê o bucket.

Cada instalação nova recebe uma credencial de backup exclusiva como segredo no
Worker da API. O exportador acede através do site de gestão, valida a propriedade
do Worker e nunca envia o token Cloudflare ao site. O site de encomendas recusa
esta rota. A operação só lista e lê imagens, não altera nem elimina objetos R2.

O arquivo de imagens é separado do SQL, cifrado com AES-GCM e identificado pelo
backup. Inclui os bytes e o SHA-256 de cada ficheiro; tem também checksum global.
Limites do piloto: 1000 imagens, 8 MiB por imagem e 32 MiB de imagens por backup.
Uma imagem removida ou alterada durante a leitura faz falhar o backup. Não existe
um snapshot atómico conjunto entre D1 e R2: suspender alterações durante backups
importantes até ser implementado um modo de manutenção consistente.

Instalações antigas não recebem este endpoint automaticamente. Precisam de pacote
e configuração atualizados. Os testes usam objetos fictícios; ainda não foram
copiadas imagens reais de uma conta Cloudflare. A validação de restauro inclui SQL e imagens em recursos separados;
a substituição em produção continua pendente. Não há descarga dos arquivos pelo
portal nesta fase. A interface expõe apenas metadados por cliente.

## Restauro de imagens para uma cópia isolada

A fila agora valida e restaura também o arquivo de imagens quando incluído. Verifica
o checksum do arquivo, os hashes individuais e os nomes suportados antes de iniciar
operações cloud. Cria um bucket `foodtruck-copy-*` e um Worker temporário ligado
exclusivamente à cópia. A origem não recebe novos bindings nem objetos.

O Worker temporário requer um segredo exclusivo da validação e expira em trinta
minutos. Cada imagem é enviada e relida, comparando SHA-256. Só após verificar todas
as imagens é removido o Worker; a base D1 e o bucket da cópia ficam preservados.
A validação combinada só fica `verified` após SQL, imagens e limpeza do Worker.
O identificador do bucket pode ser consultado em `/restores` pelo titular.

As intenções de criação, upload e limpeza são guardadas. Respostas perdidas na
criação de bucket exigem revisão do operador; não se repete a criação. Perdas durante
envio de imagens permitem repetir as mesmas escritas na cópia. Uma resposta perdida
de remoção do Worker é reconciliada consultando a tag e a intenção de limpeza.
Repetir o pedido de validação de um backup falhado retoma o mesmo registo/progresso.
Os recursos não são apagados para contornar erros.

Esta implementação substitui a limitação anterior de validação apenas SQL.
Os testes de upload/limpeza Cloudflare são simulados e o teste da fila usa PostgreSQL
local real. Ainda faltam o ensaio real em Cloudflare, a verificação funcional da
aplicação contra as cópias, a limpeza guiada das cópias e a substituição em produção
com backup prévio, confirmação e rollback.

## Ensaio funcional local das cópias

O teste `restored-runtime.test.mjs` cria dois runtimes workerd com D1 e R2 separados.
Inicializa a origem com dados fictícios, faz uma cópia lógica do esquema/dados e
copia uma imagem de teste. Na cópia verifica login, permissões de leitura, catálogo,
imagem, alteração de stock, checkout, idempotência e cancelamento com libertação
de reservas. Confirma que stock, encomendas e sessões da origem não são alterados.

É um ensaio do runtime local, não um teste das APIs remotas de export/import nem
um teste dos sites OpenNext publicados. O motor remoto tem testes simulados próprios.
O teste local não é executado automaticamente sobre bases reais de clientes.

Após validar o esquema de uma cópia remota, o motor limpa sessões de colaboradores
e clientes, tokens de recuperação/verificação e contadores temporários de acesso
apenas nessa cópia. Um login novo é necessário. Os dados de negócio e as palavras-passe
mantêm-se; os tokens e sessões da origem não são alterados. A aprovação falha se
não for possível confirmar a limpeza de todas as tabelas técnicas esperadas.
