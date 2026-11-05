# Portal piloto: instalar.migfoodtruck.pt

Origem: `https://instalar.migfoodtruck.pt`.
Callback OAuth exato:
`https://instalar.migfoodtruck.pt/api/oauth/callback`.

O domínio foi indicado pelo proprietário. Uma consulta DNS local em 2026-11-04
não encontrou registos para migfoodtruck.pt ou instalar.migfoodtruck.pt. Isto não
comprova disponibilidade para registo nem propriedade. Não houve compra, alteração
de DNS ou pedido de certificado.

## Preparação única pelo operador

1. Confirmar o registo e controlo do domínio.
2. Disponibilizar um servidor Docker com portas TCP 80/443 acessíveis.
3. Configurar o registo A (e AAAA apenas se houver IPv6 funcional) de instalar
   para esse servidor. Não substituir registos existentes sem verificar conflitos.
4. Preencher o .env privado a partir de .env.example, incluindo chaves próprias,
   credenciais Cloudflare e o caminho para um pacote assinado. Não utilizar chaves
   de teste como credenciais comerciais.
5. Registar o cliente OAuth com o callback acima. Para compradores fora da conta,
   verificar o domínio do cliente e habilitar o cliente público na Cloudflare.
6. No servidor, executar o compose com o perfil public. Caddy obtém e renova HTTPS
   quando o domínio e as portas estiverem corretamente configurados.

Comando do operador (os clientes usam apenas o portal):

`docker compose --env-file deployment/platform/.env -f deployment/platform/compose.yaml --profile public up --build -d`

Sem o perfil public, o portal fica limitado a 127.0.0.1:4200. O serviço Go e o
PostgreSQL não publicam portas. Os logs do proxy omitem URI e headers dos pedidos,
para não guardar códigos OAuth, cookies e tokens. Os certificados ficam num volume.

## Aceitação real pendente

- DNS e certificado HTTPS válidos para instalar.migfoodtruck.pt.
- Administração e compras de teste acessíveis pelo portal.
- OAuth com consentimento e retorno ao callback exato.
- Teste de subscrição na conta da plataforma e compra numa conta distinta.
- Verificação de plano, publicação, login, imagens, encomendas e manutenção.
- Backup e validação de cópias reais, com confirmação dos recursos e custos.

Não iniciar o perfil public sem confirmar domínio, servidor e segredos. A ausência
de Docker nesta máquina impediu testar as imagens e a configuração Caddy aqui.
