# Recuperação do piloto — 1.1.2-preview.4

O pacote encontra-se em `output/cloudflare/1.1.2-preview.4`.
Abrir `TESTAR-CLOUDFLARE.cmd` e preencher novamente o formulário. O token e a
palavra-passe são transmitidos pelo processo, sem serem guardados no progresso.
O mesmo identificador de compra recupera a base D1 e o bucket existentes.

## Correções

- PBKDF2-SHA256 mantém 600 000 iterações e o formato existente. Quando WebCrypto
  rejeita explicitamente o limite de iterações, a implementação noble calcula o
  mesmo resultado. Outras exceções são propagadas.
- Workers temporários registados podem ser reparados após validação da tag de
  propriedade. Intenções e hashes são guardados antes do envio. Uma resposta
  perdida permite reenviar a mesma atualização. Workers da aplicação continuam
  a exigir o percurso próprio de atualização.
- A janela expirada é renovada quando não existe upload pendente. Uploads
  pendentes exigem a mesma configuração para recuperação.
- Erros autenticados identificam a etapa e uma referência sem revelar SQL,
  palavras-passe ou tokens. O PowerShell captura os canais do processo separadamente.

## Validação efetuada

- `go -C desktop/launcher test ./...`: aprovado.
- 9 testes Node/Workers: aprovados, incluindo equivalência PBKDF2 com Node,
  rejeição simulada do limite de produção, transações D1, configuração e login.
- Teste Go de reparação com resposta perdida e recusa de recurso alheio: aprovado.
- Pacote gerado com Wrangler dry-run dos dois sites: aprovado.
- Lançador `-PrepareOnly`: aprovado, pacote, assinatura e licença de teste.

## Verificações pendentes

É necessário executar o piloto com o token fornecido no formulário para confirmar
a causa real do HTTP 503, CPU/latência de autenticação no plano da conta, publicação
dos sites e remoção da ponte. A alternativa PBKDF2 consome CPU adicional; os testes
locais não demonstram compatibilidade com o plano Free. Não é ativada faturação
automaticamente. Os sites OpenNext reutilizam os builds existentes; o pacote
continua marcado como integration-preview e não constitui uma versão comercial
aprovada. A suíte PostgreSQL não foi executada nesta correção.
