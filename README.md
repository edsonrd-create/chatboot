# Guto Bot — Guto Express 🍕

Painel demonstrativo e base de conhecimento do chatbot de atendimento da Pizzaria Guto Express, destinado a dois números de WhatsApp Business.

## Abra a prévia

O arquivo `index.html` na raiz contém CSS, JavaScript e os dados necessários para abrir a demonstração diretamente no navegador, sem dependências, login ou chaves.

### O que a demonstração oferece

- Interface responsiva de central de atendimento, navegação lateral e indicadores explicitamente demonstrativos.
- Cardápio pesquisável por sabor, ingrediente e categoria.
- **74 sabores**, **7 combos/ofertas**, **20 bebidas não alcoólicas** como fotografia informativa do cardápio público.
- Simulador local para perguntas simples sobre sabores, ingredientes, tamanhos e combos.
- Telas de conversas, pedidos, canais WhatsApp e configurações com estados pendentes corretamente exibidos.

**Atenção:** GitHub Pages e o HTML não executam atendimento real, modelos de IA na nuvem nem registro de pedidos. Não há integração com WhatsApp, Chatwoot, pagamentos ou banco de dados nesta prévia. O gráfico do painel é ilustrativo e não representa atividade real.

## Catálogo de conhecimento

Arquivo: [data/cardapio-publico.json](data/cardapio-publico.json)

- Endereço solicitado: https://pedir.to/gutoexpress (não foi possível ler diretamente).
- Fonte alternativa pública consultada: https://www.gutoexpress.com.br/cardapio?dvc=mobile&ed_mobile_iframe=1
- Data de referência: 25/10/2026.
- `startingPriceCents`: preço publicado **a partir de**, sem associação a tamanho.
- `publishedPriceCents`: anúncio de combo, sujeito às condições do momento.
- `available: true` em sabores significa **listado no catálogo de referência**, não confirmação de estoque; `availabilityVerified: false` explicita ausência de consulta em tempo real.
- `autoCheckoutEnabled: false` impede interpretar anúncio como autorização de cobrança.

Valide todos os dados com o proprietário da operação antes de publicar ofertas ou permitir vendas.

## Publicação pelo GitHub Pages

No GitHub, abra **Settings → Pages → Build and deployment**. Escolha **Deploy from a branch**, selecione `main` e a pasta `/ (root)`; salve. O GitHub disponibilizará o endereço gerado após o deploy. Esta etapa depende de ativação e confirmação no próprio GitHub.

## Caminho para o bot de verdade

1. Hospedar separadamente o serviço backend do Guto Bot com HTTPS, banco persistente e segredos apenas no servidor.
2. Conectar **dois inboxes autorizados** ao Chatwoot e verificar elegibilidade de coexistência do WhatsApp Business.
3. Sincronizar o cardápio com a fonte comercial vigente (API própria/autorizada ou revisão administrativa).
4. Fazer a IA consultar ferramentas do backend para orçamento; nunca usar texto de preço anunciado como autorização de venda.
5. Exigir endereço, taxa, valor final, pagamento e confirmação explícita antes de registrar solicitação para equipe.
6. Implantar logs auditáveis, fila de eventos idempotente, monitoramento e testes ponta a ponta.

**Segurança:** jamais coloque `.env`, tokens Meta, Chatwoot, API de IA ou dados de clientes no GitHub Pages ou repositório público.

## Estado do projeto

- ✅ Frontend estático e catálogo informativo publicados no repositório.
- ✅ Simulador básico independente de servidor.
- ⏳ Backend real, IA generativa conectada, dois números e produção ainda não publicados neste repositório.

---
Pizzaria Guto Express — protótipo V1.3.


## Treinamento realista V1.4

O simulador no `index.html` usa `simulator.js` com estado de carrinho e dois canais independentes. Testa mensagens sequenciais: múltiplas pizzas, meio a meio, alteração, bebida, endereço, pagamento, combo e bloqueio de confirmação sem orçamento.

- [Casos sintéticos de teste](training/realistic-cases.json)
- [Manual de comportamento e limites](docs/TREINAMENTO-REALISTA.md)
- [Backend para implantação](backend/README.md)
- Execute os testes do backend com `cd backend && npm test` (Node.js 22+).

Esta interface publicada no GitHub Pages é apenas uma simulação com regras locais. O chatbot real requer infraestrutura, credenciais e homologação com Chatwoot/WhatsApp.
