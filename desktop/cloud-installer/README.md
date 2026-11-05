# Food Truck Live Cloud

> **Percurso avançado.** Para clientes sem conhecimentos técnicos, o caminho principal é o portal de instalação com alojamento gerido (sem conta Cloudflare, token nem licença). Este assistente de secretária destina-se a quem quer instalar na sua própria conta Cloudflare; ver [deployment/platform/README.md](../../deployment/platform/README.md).

Este diretório contém o assistente Tauri 2 e a comunicação com o motor Go através de stdin/stdout.

## Estado de integração

O assistente verifica o pacote, consulta as contas autorizadas, valida a licença e recolhe os dados do negócio. A publicação está ligada ao motor e exige um pacote de lançamento assinado, uma licença válida e confirmação dos custos. Os pacotes de integração não ativam a publicação. Este assistente ainda não está pronto para distribuição comercial.

O token é enviado ao executável auxiliar por stdin e é removido do campo após submissão. A interface não o persiste. Os erros devolvidos pelo motor não incluem os pedidos originais nem credenciais.

## Desenvolvimento

Na raiz do repositório, preparar o executável auxiliar Windows com `node desktop/cloud-installer/prepare-engine.mjs x86_64-pc-windows-msvc` e verificar o Tauri com `cargo check --manifest-path desktop/cloud-installer/src-tauri/Cargo.toml`.

O comando de preparação também suporta `aarch64-apple-darwin`, `x86_64-apple-darwin` e `x86_64-unknown-linux-gnu`. Cada pacote deve ser compilado no sistema correspondente. O workflow `cloud-installer.yml` gera artefactos de integração por plataforma, sem publicar uma versão comercial.

Testes do motor com `go -C desktop/launcher test ./...`. Testes dos formulários com `node --test desktop/cloud-installer/ui.test.mjs`, com Playwright instalado. A ponte nativa é simulada nesse teste de interface.

## Licenças do vendedor

O comando `desktop/launcher/cmd/license-tool` gera chaves Ed25519 e emite licenças para uma conta Cloudflare. A ferramenta é exclusiva do vendedor. Escolher uma pasta privada fora do pacote para os ficheiros de chave.

Na pasta `desktop/launcher`, executar `go run ./cmd/license-tool -mode generate -private-key <ficheiro-privado.pem> -public-key <ficheiro-publico.txt>` para criar as chaves. Depois, emitir cada licença com `go run ./cmd/license-tool -mode issue -private-key <ficheiro-privado.pem> -account <conta-cloudflare> -order <compra> -out <licenca.json>`. Os comandos recusam substituir ficheiros existentes.

A chave pública em base64url é fornecida por `FOODTRUCK_LICENSE_PUBLIC_KEY` ao comando `prepare-engine.mjs`. No CI, configurar a variável de repositório com o mesmo nome. A chave privada permanece exclusivamente com o vendedor. Builds de integração sem chave pública recusam verificar licenças.

Para assinar um pacote, executar `go run ./cmd/license-tool -mode sign-package -private-key <ficheiro-privado.pem> -package <pasta-do-pacote>`. A ferramenta verifica o inventário antes de criar `manifest.signature`. O motor valida essa assinatura, a licença e o estado de lançamento antes de efetuar pedidos de publicação. Assinar uma prévia não altera o seu estado.

No assistente, o cliente seleciona a conta e o ficheiro de licença. O motor verifica a assinatura, o produto e a conta, e repete essa verificação antes de criar recursos.

## Validação efetuada

- Motor Go compilado para Windows x64.
- Verificação de compilação do Tauri no Windows aprovada.
- Testes Go aprovados, incluindo uma instalação completa contra a API Cloudflare simulada. O ensaio cobre a assinatura, aprovação de custos, criação de D1 e R2, configuração, perda de resposta, retoma, limpeza e verificação dos dois sites.
- Teste de interface em Chromium aprovado, com contas Cloudflare simuladas.

Permanecem pendentes o teste da janela nativa, os pacotes finais, a execução dos workflows nas outras plataformas e a publicação real numa conta Cloudflare autorizada.
