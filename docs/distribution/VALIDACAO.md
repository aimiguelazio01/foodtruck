# Validação — Food Truck Live 1.0.1

Verificações efetuadas em Windows x64, Node.js 24.18.0, Next.js 16.4.3 e PostgreSQL local 18.6, em 3 de novembro de 2026. Os testes utilizam dados fictícios e bases independentes.

## Iniciador universal 1.0.1

A entrega em release/marketplace contém exatamente dois ficheiros: Food_Truck_Live-1.0.1.zip e INICIAR.mjs. O manifesto está dentro do ZIP e o checksum do arquivo está incorporado no iniciador.

Passaram oito testes adicionais: extração e UTF-8, recusa de caminhos fora da instalação, recusa de ficheiros danificados, deteção de npm nos caminhos Windows/macOS/Linux e por symlink, erro claro sem npm, extração do arquivo real, reutilização da instalação e preservação de dados perante um ZIP incorreto.

O teste completo partiu apenas destes dois ficheiros numa pasta nova em Windows. Passaram a extração automática, instalação de dependências, build, demo apenas de consulta, sistema novo, login após reinício, persistência e encerramento dos processos. Os dados ficaram fora do código, em .foodtruck/data, sem uma pasta data pré-existente na raiz do código.

macOS Intel/Apple Silicon e Linux x64/ARM64 com glibc têm caminhos e arranque preparados; os testes de resolução de npm simulam essas plataformas. Não foi efetuado um teste nativo nesses sistemas, portanto não se declara validação em hardware real. Não execute como root/sudo. A pasta PostgreSQL de um sistema não deve ser copiada diretamente para outro sistema operativo.

## Resultados

| Verificação | Resultado |
| --- | --- |
| Tipos da API | Passou |
| Build dos dois sites e API | Passou |
| Migrações vazias e repetidas | Passou |
| Token ausente/expirado e configuração concorrente | Passou; apenas uma configuração é criada |
| Login, produto, inventário, receita e upload | Passou |
| Encomenda e consumo de stock | Passou |
| Demo: três negócios, 30 produtos, 72 encomendas | Passou |
| Escritas diretas na API demo | Recusadas com 403 |
| Manutenção: autenticação, bloqueio e preservação demo | Passou |
| Instalação a partir do ZIP sem dependências instaladas | Passou nesta máquina Windows, numa pasta extraída isolada |
| Demo, assistente e início de sessão no navegador | Passou em Chromium |
| Persistência e encerramento dos serviços locais | Passou |
| Backup a frio e restauro noutra pasta/porta | Passou; conta e negócio preservados |
| Layout móvel | Verificado a 375 px, sem deslocamento horizontal |
| Manuais PDF | Regenerados e revistos visualmente, 23 e 12 páginas |
| ZIP: hashes, imagens e exclusão de ficheiros | Passou |
| Novo empacotamento sem Git | Passou a partir do conteúdo extraído |
| Padrão de chave privada no conteúdo | Empacotamento recusado pelo teste |
| Cloudflare: build dos dois sites | Passou com OpenNext 1.20.15 e Wrangler 4.157.0 |
| Cloudflare: pré-visualização local | Ambos responderam HTTP 200; assistente de gestão presente |

## Limites da verificação

Não foi utilizada uma máquina virtual Windows limpa: a instalação foi exercitada numa pasta nova, sem node_modules, .env ou dados do projeto original, usando apenas o ZIP e ferramentas instaladas no computador.

Docker não está disponível neste ambiente. A configuração foi preparada, mas não foi executada em macOS/Linux. Não foi feito deploy numa conta Vercel ou Cloudflare nem validado o percurso completo com base/storage externos, email e domínios públicos. A pré-visualização Workers usa um URL de API de exemplo; confirma o artefacto e as rotas, não uma instalação cloud operacional.

O perfil Windows usa pg_ctl para terminar a base de forma limpa e io_method=sync. As garantias de WAL/fsync mantêm-se ativas. O restauro exercitado foi a cópia da pasta local com os serviços parados; pg_dump/pg_restore e storage remoto exigem ensaio no alojamento escolhido.

## Repetir os testes

```sh
npm ci --include=dev
npm run typecheck
npm run build
npm test
npm run test:release
npm run test:marketplace
npm run test:launcher
```

O teste de API cria PostgreSQL na porta 55439 (configurável com TEST_PG_PORT). O teste de navegador usa 3000, 3001, 4000, 5433, 5434 e 55440, cria um diretório de aceitação independente e exige Chromium do Playwright instalado. Nenhum teste importa a base operacional. Os testes históricos SQLite ficam fora da distribuição.
