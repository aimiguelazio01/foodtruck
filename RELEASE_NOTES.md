# Food Truck Live 1.1.2 — instaladores

- Demo editável e isolada, com uploads e encomendas de teste; pagamentos e emails simulados.
- Acesso ao catálogo principal e fotografias das três carrinhas demo.
- Fundo do catálogo principal, fundo por carrinha, quatro fontes e três layouts com pré-visualização.
- Migrações preservam dados existentes.

# Food Truck Live 1.1.1 — instaladores

- Corrige fotografias demo nos sites de cliente e gestão: os caminhos PostgreSQL `/images/products/*.webp` passam a ser apresentados pela interface.
- Preserva dados demo e operacionais existentes; não exige recriar a base.
- Acrescenta teste de navegador que verifica a apresentação e descodificação das 30 fotografias nos três menus de cliente e das fotografias no menu de gestão.

# Food Truck Live 1.0.1

- Apenas dois ficheiros de entrega: um ZIP completo e INICIAR.mjs exterior.
- Iniciador universal Node.js para Windows x64, macOS x64/ARM64 e Linux x64/ARM64 com glibc.
- Verificação SHA-256, extração automática, código separado por versão e dados persistentes em .foodtruck/data.
- Deteção de npm adaptada aos percursos oficiais, Homebrew e distribuições Linux.
- A demo de consulta, sistema novo, perfis web e recursos originais da versão 1.0.0 são preservados.

Validação nativa: Windows. Compatibilidade macOS/Linux preparada e coberta por testes de resolução de caminhos; execução nativa ainda por validar.

# Food Truck Live 1.0.0

- ZIP versionado com lista explícita de ficheiros, manifesto SHA-256 e empacotamento independente de Git.
- Lançador Windows com PostgreSQL local, verificação de portas, instalação de dependências, compilação e abertura do navegador.
- Demo PostgreSQL isolada, apenas de consulta, preservando dados e imagens fictícias.
- Assistente inicial protegido por token com validade de uma hora; cria administrador, organização e primeiro negócio numa transação.
- Perfil Docker local em localhost, separado do perfil público com HTTPS.
- Manutenção agendada com autenticação e bloqueio PostgreSQL entre processos.
- Configurações Vercel e Cloudflare híbrida; versões efetivamente testadas e limitações constam do relatório de validação.

Não existe reposição destrutiva de um sistema configurado. Pagamentos reais, faturação fiscal, compras no marketplace e licenciamento comercial não são adicionados nesta versão.
