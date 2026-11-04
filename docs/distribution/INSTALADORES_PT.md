# Instaladores Food Truck Live 1.1.2

Os instaladores incluem a aplicação pronta, Node.js, PostgreSQL e dados demo fictícios. O utilizador não precisa de instalar Node.js/npm, de compilar código nem de executar comandos. O programa abre no navegador habitual, através do ícone instalado.

| Computador | Ficheiro |
| --- | --- |
| Windows 10/11 x64 | Food_Truck_Live-1.1.2-windows-x64-Setup.exe |
| macOS Apple Silicon, macOS 14 ou superior | Food_Truck_Live-1.1.2-macos-arm64.pkg |
| macOS Intel, macOS 14 ou superior | Food_Truck_Live-1.1.2-macos-x64.pkg |
| Ubuntu/Debian x64 | Food_Truck_Live-1.1.2-linux-amd64.deb |
| Ubuntu/Debian ARM64 | Food_Truck_Live-1.1.2-linux-arm64.deb |

## Instalar e abrir

No Windows, execute o Setup e siga o assistente. No macOS, abra o PKG e siga o instalador; o programa fica em Aplicações. No Ubuntu/Debian, abra o DEB no instalador de software. Depois abra Food Truck Live no ambiente de trabalho ou menu de aplicações.

Escolha «Abrir demo» para experimentar edição, uploads e encomendas simuladas ou «Criar sistema novo / abrir o meu sistema» para dados próprios. A primeira configuração pede administrador, organização e primeiro negócio. O programa arranca os serviços automaticamente e abre a aplicação. A demo e o sistema real usam bases separadas.

O ecrã inicial mantém o botão «Encerrar aplicação». Utilize-o para terminar os serviços; fechar apenas o navegador mantém o programa em execução. Abrir novamente o ícone mostra o ecrã inicial da instância existente.

## Personalização

Em Personalização, configure a cor de fundo do catálogo principal. Em Página de encomendas → Editar página, cada carrinha tem cor de fundo própria, quatro fontes, três layouts, pré-visualização e reposição do aspeto original. O botão «Ver página de encomendas» abre o catálogo principal com as fotografias das três carrinhas demo.

Os emails e pagamentos da demo são simulados. As alterações ficam na base demo, separada do sistema próprio.

## Dados e atualizações

- Windows: pasta FoodTruckLive nos dados de aplicações do utilizador (AppData/Roaming).
- macOS: ~/Library/Application Support/FoodTruckLive.
- Linux: ~/.local/share/food-truck-live, ou XDG_DATA_HOME/food-truck-live.

As subpastas demo e system são independentes. O programa instalado nunca guarda a base dentro da pasta de código. Desinstalar remove o programa e os atalhos, preservando os dados. Faça backup antes de atualizar e encerre a aplicação antes de instalar uma versão nova.

Esta edição é distinta do ZIP para programadores/servidores. Os manuais de utilização continuam aplicáveis à gestão; as instruções de Node.js e INICIAR.mjs nos manuais anteriores referem-se à distribuição de código, não a estes instaladores. As referências antigas a demo apenas de consulta foram substituídas nesta versão pela demo editável descrita neste guia.

## Validação e assinatura

Os instaladores são gerados em Windows, incluindo os formatos PKG e DEB. A inspeção verifica os conteúdos, permissões e arquitetura dos binários. A execução nativa testada é Windows; ainda é necessário ensaiar a instalação e utilização em computadores macOS e Linux reais.

Os pacotes não incluem assinatura de editor nem notarização Apple. Essas etapas exigem certificados/conta do editor e são necessárias antes de anunciar uma distribuição comercial verificada. Não são gerados certificados fictícios nem alteradas as definições de segurança do sistema.

## Reproduzir a construção

São necessários Node.js 24, npm, Go e Python 3 com Pillow na máquina de construção. Execute os comandos na raiz do projeto:

```sh
npm ci --include=dev
npm run build
node node_modules/typescript/bin/tsc -p desktop/tsconfig.json
node desktop/setup-tools.mjs
node desktop/prepare.mjs
python desktop/package-native.py windows-x64
python desktop/package-native.py macos-arm64
python desktop/package-native.py macos-x64
python desktop/package-native.py linux-x64
python desktop/package-native.py linux-arm64
python desktop/validate-installers.py
python desktop/finalize-release.py
```

As ferramentas ficam em tmp/installer-tools; a área de construção em output/installers; os instaladores e SHA-256 em release/installers. Os downloads Node.js são verificados pelo SHASUMS256 oficial. As dependências são selecionadas por sistema/CPU e o Postgres é preparado antes de instalar, incluindo os nomes de bibliotecas necessários.

O escritor PKG macpkg é fixado ao commit fed540b6173f5b09690709e38b65465f74768ca6 e recebe uma correção local para caminhos POSIX em arquivos construídos em Windows. Não é usado o escritor DMG, cujo fallback não inclui a aplicação neste ambiente.
