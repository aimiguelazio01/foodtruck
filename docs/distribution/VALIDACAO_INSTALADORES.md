# Validação dos instaladores Food Truck Live 1.1.2

## Conteúdo desta atualização

Demo editável e isolada com produtos, stock, uploads, contas e encomendas de teste. Emails e pagamentos simulados. Fotografias dos produtos e das três carrinhas demo, acesso ao catálogo principal, cor de fundo do catálogo e personalização por carrinha com quatro fontes, três layouts e pré-visualização. Migrações 017 e 018 preservam dados existentes.

## Windows x64 — testes concluídos

- Motor nativo sem Node.js/npm no PATH; controlo privado e instância única.
- Demo nova, fotografias dos três menus e catálogo de carrinhas, acesso ao catálogo principal e edição pela interface.
- Sistema novo independente, configuração inicial, reinício, início de sessão e persistência.
- Encerramento limpo dos serviços iniciados pelo programa.
- Setup 1.1.2 executado numa pasta isolada: atalho, registo de desinstalação, Node.js incluído e abertura do programa instalado.
- Desinstalação concluída, com remoção do programa/atalhos e preservação dos dados de teste.
- Testes unitários do lançador aprovados.

Registos: `output/distribution/installer-1.1.2-native.log`, `installer-1.1.2-setup.log` e `installer-1.1.2-validation.log`.

## Personalização — navegador em localhost

Gravação pela API e pelo editor, quatro fontes, três layouts, cores de fundo, pré-visualização e apresentação a 1440 e 375 px verificadas. O fundo do catálogo principal é independente do fundo dos menus das carrinhas. Valores inválidos são recusados. A compilação incluída nos cinco pacotes corresponde à aplicação testada.

## macOS e Linux — inspeção dos pacotes

PKG Intel/Apple Silicon: XAR, BOM, aplicação completa, caminhos POSIX, permissões e arquitetura Mach-O verificados.

DEB amd64/ARM64: contentor Debian, arquitetura, atalho, aplicação completa e permissões/arquitetura ELF verificados. Destinam-se a Ubuntu/Debian compatíveis.

Os cinco pacotes incluem as migrações 017/018, fotografias das carrinhas e API de personalização. A execução nativa em macOS/Linux ainda não foi testada nesses sistemas.

## Distribuição

Os pacotes não estão assinados nem notarizados pela Apple. `SHA256SUMS.txt` verifica integridade; não substitui assinatura de editor. O manifesto identifica a versão, arquitetura, tamanho e estado de validação de cada pacote.
