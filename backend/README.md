# Guto Bot Humanizado — V1.6 (backend de homologação)

Serviço Node.js 22+ e painel para **homologar** chatbot humanizado com dois canais Chatwoot, cardápio configurável, regras determinísticas de orçamento e revisão humana.

## O que mudou nesta versão

- Ao trocar sabor, o resumo reflete os ingredientes/sabores corretos e recalcula o preço.
- Ao alterar **uma unidade** de duas pizzas iguais, separa a linha do carrinho sem modificar a outra.
- Modalidade **RETIRADA** sem endereço e sem frete; trocar para ENTREGA exige novo orçamento.
- Dúvidas sobre alergias alimentares são transferidas diretamente à equipe, sem prometer ausência de alergênicos.
- Entrada em modo humano gera nota privada na conversa, quando o Chatwoot estiver configurado.
- `npm test` executa suíte completa, incluindo conversas multi-turno sintéticas e IA simulada via respostas HTTP.

## Executar localmente

```bash
cp .env.example .env
# Defina ADMIN_PASSWORD (>=12 caracteres) e APP_SECRET (>=32 caracteres) no .env local
npm test
npm start
```

Painel: http://127.0.0.1:8080

Sem chave `OPENAI_API_KEY`, o fallback atende **somente FAQ básica**, não faz pedidos livres completos. Nunca cadastre preços fictícios para vender: o sistema bloqueia confirmação sem cotação atual. O Chatwoot precisa ser configurado com **dois inboxes de WhatsApp autorizados**, IDs distintos, segredo de webhook e token no servidor.

## Publicação

O arquivo `Dockerfile` é para backend Node 22 em instância única com volume persistente para `/app/data`, domínio HTTPS via proxy e variáveis privadas no provedor. `compose.yaml` publica apenas em localhost por segurança. GitHub Pages publica somente a prévia estática da raiz do repositório, não o backend.

## Limitações críticas

**Não está em produção.** Não foi testado com dois números reais nem com chamadas reais à IA. O armazenamento atual é JSON em disco (1 réplica); produção escalável exige PostgreSQL, Redis/fila durável, auditoria e políticas de backup. Não há transcrição de voz, integração PDV, cálculo de entrega por bairro, confirmação de pagamento ou atribuição automática a atendente. Não usar com clientes reais até concluir `docs/HOMOLOGACAO-V16.md`.

**Documentação da assinatura Chatwoot:** https://www.chatwoot.com/hc/user-guide/articles/1677693021-how-to-use-webhooks
