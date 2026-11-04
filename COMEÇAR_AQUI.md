# Food Truck Live — iniciar em Windows, macOS ou Linux

## Dois ficheiros para download

Guarde **INICIAR.mjs** e **Food_Truck_Live-1.0.1.zip** na mesma pasta gravável. Toda a aplicação, dados demo, recursos, manuais, configurações e manifesto estão dentro do ZIP. O único ficheiro exterior é o iniciador universal. Não precisa de descompactar manualmente.

## Arrancar

Instale Node.js 24 LTS com npm a partir de https://nodejs.org. Abra um terminal na pasta dos dois ficheiros e execute, nos três sistemas:

```sh
node INICIAR.mjs
```

Escolha **1 — Abrir demo** ou **2 — Criar sistema novo / abrir o meu sistema**. O iniciador verifica o ZIP, descompacta a aplicação, instala as dependências específicas do computador e abre o navegador. A primeira utilização precisa de internet e pode demorar alguns minutos.

No Windows: Terminal ou PowerShell. No macOS: Terminal. No Linux: terminal da sua distribuição. Não execute com sudo/root. Não é necessário Docker, Git ou Python para este percurso.

Plataformas previstas: Windows x64; macOS Intel x64 e Apple Silicon ARM64; Linux x64 e ARM64 com glibc (por exemplo Ubuntu/Debian). Windows ARM nativo e distribuições Linux musl/Alpine não fazem parte deste perfil. Os testes nativos efetuados foram em Windows; macOS/Linux ainda precisam de validação num computador real.

## Dados e versões

Depois do primeiro arranque, aparece uma pasta oculta **.foodtruck**. O código fica em .foodtruck/releases e os seus dados em .foodtruck/data/system; a demo usa .foodtruck/data/demo. Não elimine nem partilhe esta pasta. Não copie node_modules ou uma pasta PostgreSQL entre sistemas operativos.

A demo permite apenas consulta. Para mudar de opção, termine com Ctrl+C e volte a executar o iniciador. Num sistema novo, a ligação privada abre o assistente para criar administrador, organização e primeiro negócio. Depois da configuração, abre o início de sessão.

Clientes: http://localhost:3000. Gestão: http://localhost:3001. Os serviços escutam apenas na máquina local. Mantenha o terminal aberto e termine com Ctrl+C. Antes de atualizar, faça backup com todos os serviços terminados. Substitua o ZIP e INICIAR.mjs juntos, mantendo .foodtruck; cada versão tem código próprio e reutiliza os dados.

## Publicar na web

Pode descompactar o ZIP manualmente para obter o código e seguir docs/manuals/INSTALACAO_PT.md. Mantêm-se os perfis Vercel, Cloudflare com API externa e Docker. Os manuais PDF e o manifesto estão dentro do ZIP.
