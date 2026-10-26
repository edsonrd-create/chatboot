# Guto Bot V1.9 — auditoria de integração e critérios de homologação

**ESTADO: EM DESENVOLVIMENTO, NÃO APROVADO PARA CLIENTES OU PRODUÇÃO.**

## Repositório PDV auditado
Inspecionado `edsonrd-create/guto-express-pdv` / `main`:

- `GET /api/v1/menu` — cardápio público do PDV com IDs, tamanhos, preço, categorias e disponibilidade.
- `GET /api/v1/store` — estados de funcionamento, entrega e retirada.
- `POST /api/v1/quote` — cálculo de **taxa de entrega**, não é contrato de cotação de todos os itens.
- `/api/v1/action/*` — eventos GEDV e ações operacionais com possíveis efeitos; **não deve ser usado para criar novos pedidos**.
- Criação de pedidos está em funções internas com papéis de operação, não há contrato público de inclusão/autenticação/idempotência validado para o bot.

## Alterações no Guto Bot
- `src/pdv-integration.mjs`: consulta PDV somente por GET às rotas autorizadas; limita tamanho, tempo, conteúdo e domínio HTTPS; falha fechada.
- `/configuracoes`: página de gestão servida pelo Node, com CSS/JS independentes do `index.html` estático.
- `GET /api/settings` / `PUT /api/settings`: persistência no backend com autenticação e validação de domínio. Segredos não ficam no HTML.
- `POST /api/pdv/test`: diagnóstico real de leitura, sem mudar o PDV.
- `GET /api/pdv/menu`: consulta autenticada ao cardápio vigente; **não efetua cobrança**.
- `GET /api/readiness`: checklist explícito; não permite declarar prontidão antes da homologação.
- Webhooks recebidos continuam no histórico, mas o bot **não responde automaticamente** antes da liberação. Handoff interno aponta que um humano precisa assumir.
- `ordersMode=DISABLED` — envio de novos pedidos não é implementado nesta etapa.

## Critérios de aceite para liberação
| Requisito | Estado |
|---|---|
| Testes automatizados locais e CI | A verificar nesta branch |
| Layout desktop e celular, contraste e acessibilidade | PENDENTE de avaliação visual real |
| Integração leitura PDV ao vivo | PENDENTE de resposta em homologação |
| Contrato seguro de inclusão no PDV e deduplicação transacional | PENDENTE |
| Dois WhatsApps reais, login via processo oficial e mensagens bidirecionais | PENDENTE |
| IA conectada e avaliada com conversas inéditas, pedidos ambíguos e correções | PENDENTE |
| Taxas de entrega, promoções, pagamento e estoque atualizados | PENDENTE |
| Produção/KDS em ponta a ponta sem duplicação | PENDENTE |
| Monitoramento, backups, recuperação, segurança e carga | PENDENTE |
| Aprovação operacional da pizzaria | PENDENTE |

**Nunca marcar o produto como 100% pronto apenas por sucesso em testes sintéticos.**

## Dependências reais
Será necessário um endpoint específico no PDV para **aceitar pedidos confirmados**, autenticado entre servidores, idempotente (identificador externo único), com recálculo dos valores a partir dos IDs válidos, validação de horário/estoque/restrição de sabores, transação, auditoria e resposta com número oficial do pedido. Deve ser testado em ambiente separado antes de ativar em produção.

O backend atual usa armazenamento JSON em disco, próprio para uma instância de teste. Para operação 24 horas deve migrar para PostgreSQL com retenção, concorrência e backup confiáveis; não executar migração destrutiva no PDV existente.

## Testes
`cd backend && npm test`

Testes locais sintéticos e mocks **não** atestam conexão real Meta, Chatwoot, PDV ou IA. O navegador automatizado no ambiente de desenvolvimento pode ter bloqueio de rede local; homologação visual segue pendente.
