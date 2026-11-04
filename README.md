# Food Truck Live

Aplicação em português (Portugal), com dois sites Next.js, API Node.js e PostgreSQL.

## Instaladores com ícone (1.1.2)

A pasta `release/installers` contém Setup Windows x64, PKG macOS Intel/Apple Silicon e DEB Ubuntu/Debian x64/ARM64. Incluem Node.js, PostgreSQL e a aplicação já compilada; não exigem Node/npm nem comandos no computador do utilizador. O ícone abre a aplicação no navegador habitual.

Leia [Instaladores: utilização e validação](docs/distribution/INSTALADORES_PT.md). Os dados ficam numa pasta do utilizador, separada do programa e preservada na desinstalação. Os pacotes não estão assinados/notarizados. A execução nativa foi testada em Windows; macOS/Linux permanecem por ensaiar nesses sistemas.

## Instalar a distribuição de código (1.0.1)

A entrega para marketplace contém apenas **Food_Truck_Live-1.0.1.zip** e **INICIAR.mjs**, lado a lado. Com Node.js 24 LTS e npm instalados, execute no terminal:

```sh
node INICIAR.mjs
```

O mesmo iniciador serve Windows x64, macOS x64/Apple Silicon e Linux x64/ARM64 com glibc. Verifica e extrai o ZIP automaticamente. Não precisa de Docker, Git nem Python. A primeira utilização requer internet. Não execute com sudo/root.

Escolha **Abrir demo** (apenas consulta) ou **Criar sistema novo / abrir o meu sistema**. Os dados ficam em `.foodtruck/data`, separados do código extraído em `.foodtruck/releases`. Substitua iniciador e ZIP juntos ao atualizar; preserve os dados e faça backup primeiro.

Leia [COMEÇAR_AQUI.md](COMEÇAR_AQUI.md) e o [manual de instalação](docs/manuals/INSTALACAO_PT.md). Os manuais PDF e manifesto estão dentro do ZIP. O percurso local foi testado em Windows; a execução nativa em macOS/Linux está preparada, mas ainda não foi testada nesses sistemas.

## Perfis web

Para publicar na web, extraia o ZIP manualmente. Inclui Docker local/servidor, Vercel (sites e API separados) e Cloudflare (sites Workers com API externa). PostgreSQL e storage seguem o perfil escolhido. Não se distribuem dados reais nem segredos.

## Desenvolvimento e distribuição

Requisitos: Node.js 24 com npm; Python 3 apenas para gerar ZIP e PDFs. Não é necessário Git para empacotar.

```sh
npm ci --include=dev
npm run install:init
# Editar .env.install
npm run install:check
npm run db:migrate
npm run install:token
npm run build:install
npm start
```

Abra a ligação privada mostrada por `install:token`. Para desenvolvimento, depois de configurar a base, use `npm run dev`.

```sh
npm run typecheck
npm run test:distribution
npm run test:release
npm run package:release
```

O ZIP versionado e o iniciador ficam em `release/marketplace`, sem outros ficheiros exteriores. O manifesto fica dentro do ZIP e o iniciador contém o checksum SHA-256 do arquivo. A lista explícita de ficheiros é `scripts/release-files.json`. Consulte `docs/distribution/INVENTARIO.md` e `docs/distribution/VALIDACAO.md`.

`npm test` executa a validação PostgreSQL da distribuição. Os testes históricos SQLite e Playwright ficam fora do pacote.

A aplicação não adiciona pagamentos de cartão nem faturação certificada. A localização pública usa paragens e eventos publicados. Mapas e email precisam de acesso aos respetivos serviços externos.
