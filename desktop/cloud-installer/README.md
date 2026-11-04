# Food Truck Live Cloud

Este diretório contém o assistente Tauri 2 e a comunicação com o motor Go através de stdin/stdout.

## Estado de integração

Funcionam a verificação do pacote de aplicação e a consulta das contas autorizadas pelo token Cloudflare. A interface identifica explicitamente que a configuração do negócio e a publicação completa estão pendentes. Este assistente ainda não está pronto para distribuição comercial.

O token é enviado ao executável auxiliar por stdin e é removido do campo após submissão. A interface não o persiste. Os erros devolvidos pelo motor não incluem os pedidos originais nem credenciais.

## Desenvolvimento

Na raiz do repositório, preparar o executável auxiliar Windows com `node desktop/cloud-installer/prepare-engine.mjs x86_64-pc-windows-msvc` e verificar o Tauri com `cargo check --manifest-path desktop/cloud-installer/src-tauri/Cargo.toml`.

O comando de preparação também suporta `aarch64-apple-darwin`, `x86_64-apple-darwin` e `x86_64-unknown-linux-gnu`. Cada pacote deve ser compilado no sistema correspondente. O workflow `cloud-installer.yml` gera artefactos de integração por plataforma, sem publicar uma versão comercial.

Testes do motor com `go -C desktop/launcher test ./...`. Testes dos formulários com `node --test desktop/cloud-installer/ui.test.mjs`, com Playwright instalado. A ponte nativa é simulada nesse teste de interface.

## Licenças do vendedor

O comando `desktop/launcher/cmd/license-tool` gera chaves Ed25519 e emite licenças para uma conta Cloudflare. A ferramenta é exclusiva do vendedor. Escolher uma pasta privada fora do pacote para os ficheiros de chave.

Na pasta `desktop/launcher`, executar `go run ./cmd/license-tool -mode generate -private-key <ficheiro-privado.pem> -public-key <ficheiro-publico.txt>` para criar as chaves. Depois, emitir cada licença com `go run ./cmd/license-tool -mode issue -private-key <ficheiro-privado.pem> -account <conta-cloudflare> -order <compra> -out <licenca.json>`. Os comandos recusam substituir ficheiros existentes.

A chave pública em base64url é fornecida por `FOODTRUCK_LICENSE_PUBLIC_KEY` ao comando `prepare-engine.mjs`. No CI, configurar a variável de repositório com o mesmo nome. A chave privada permanece exclusivamente com o vendedor. Builds de integração sem chave pública recusam verificar licenças.

No assistente, o cliente seleciona a conta e o ficheiro de licença. O motor verifica a assinatura, o produto e a conta. A licença ainda precisa de ser ligada ao controlo obrigatório da publicação completa.

## Validação efetuada

- Motor Go compilado para Windows x64.
- Verificação de compilação do Tauri no Windows aprovada.
- Testes Go aprovados, incluindo pedidos inválidos e ausência de credenciais nas respostas de erro.
- Teste de interface em Chromium aprovado, com contas Cloudflare simuladas.

Permanecem pendentes o teste da janela nativa, a ligação das etapas de publicação, os pacotes finais, a execução dos workflows nas outras plataformas e a publicação real numa conta Cloudflare autorizada.
