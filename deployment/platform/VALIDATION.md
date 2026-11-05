# Validação do piloto — 2026-11-04

## Compatibilidade do restauro

O executor verifica a assinatura do pacote e associa a versão ao progresso antes
da importação. Compara a tabela foodtruck_schema_migrations da cópia com os nomes,
sequência e checksums do manifesto assinado e o intervalo de esquema permitido.
Histórico alterado, lacunas ou versões incompatíveis impedem a aprovação. Mudar
o pacote durante uma validação interrompida exige revisão do operador.
O endpoint /restores devolve packageVersion e schemaVerified.

## Resultados

- Testes Go: aprovados, incluindo histórico de migrações e falhas de recuperação.
- Suíte Cloudflare completa: 40 testes aprovados, com workerd/D1/R2 locais e mocks.
- Cenários partilhados de inventário, catálogo e equipa em PostgreSQL: aprovados.
- Builds OpenNext dos sites de encomendas e gestão: aprovados.
- Wrangler dry-run dos dois bundles: aprovado.
- Pacote 1.1.2-preview.5: gerado; inventário e checksums verificados pelo motor Go.

O teste de equipa tinha uma contagem incorreta: o fixture contém três membros e
um utilizador não associado. A expectativa passou a comparar a contagem inicial
com o acréscimo de um membro e a confirmar que a tentativa duplicada não a altera.
O mesmo cenário passou em D1 e PostgreSQL.

## Limites

O pacote em output/cloudflare/1.1.2-preview.5 é uma integration-preview sem
assinatura de vendedor. Deve ser assinado antes de o serviço central o aceitar.
Não houve publicação ou alteração da instalação real nesta etapa. OpenNext em
Windows emite aviso oficial de suporte parcial; sucesso de build não valida
funcionamento em produção.

Continuam pendentes: OAuth real público com domínio configurado, publicação do
portal HTTPS, ensaios funcionais remotos contra cópias isoladas, substituição em produção
com backup prévio/rollback, limpeza guiada de recursos e aceitação end-to-end.
Os testes locais não comprovam utilização de CPU ou faturação da conta Cloudflare.

## Ensaio funcional local acrescentado

Uma cópia lógica D1/R2 foi testada em workerd separado: login, catálogo, leitura de
imagem, alteração de stock, checkout idempotente, reservas e cancelamento. O teste
confirmou que a origem manteve stock, encomendas, reservas e sessões inalterados.
O SQL usado pelo motor para limpar sessões e tokens temporários da cópia também
foi executado neste ensaio; a sessão original foi recusada na cópia e um novo login
funcionou. Esta cópia lógica local não testa as APIs remotas de export/import.

O portal desativa o logging de pedidos Next em desenvolvimento, evitando registar
URLs de callback com códigos OAuth. O reverse proxy público deve também omitir ou
redigir a query do callback. É necessária configuração real de domínio e cliente
OAuth antes de validar esse percurso publicado.

## Endereço do piloto

O proprietário indicou migfoodtruck.pt. A configuração preparada utiliza
https://instalar.migfoodtruck.pt e o callback /api/oauth/callback. O perfil Docker
public inclui Caddy, volumes de certificados e portas 80/443; o serviço e PostgreSQL
mantêm-se privados. A sintaxe YAML foi validada; as imagens/Caddy não foram executados,
porque Docker não está disponível nesta máquina.

As consultas DNS local e Cloudflare DNS-over-HTTPS devolveram NXDOMAIN para o
domínio em 2026-11-04. Isto não determina a disponibilidade de registo nem a sua
propriedade. Não houve alterações DNS, contratação de domínio ou emissão de certificado.
