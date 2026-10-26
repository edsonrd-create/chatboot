# Guto Bot V1.6 — Homologação de pedidos como na operação real

**Status:** implementação e testes sintéticos em ambiente local; **NÃO** homologado com os dois números reais, Chatwoot de produção ou API de IA real. Os testes de modelo neste pacote usam respostas HTTP controladas. Não confundir as respostas simuladas com avaliação de compreensão do modelo.

## Comportamento esperado

1. Capturar informações distribuídas por várias mensagens: tamanho, quantidade, sabores, bebida, endereço, modalidade, pagamento e observações.
2. Tratar nomes aproximados sem trocar ingredientes ou adicionar itens não solicitados; perguntar quando houver dúvida.
3. Combinar uma ou duas metades de sabores com a política comercial de precificação definida.
4. Ao receber 'troca uma calabresa por portuguesa' depois de duas pizzas iguais, **alterar uma unidade, não ambas**, com cálculo atualizado.
5. Se houver duas pizzas de composições diferentes, não escolher qual alterar sem esclarecer.
6. Para **retirada no balcão**, não exigir endereço nem cobrar frete. Se voltar para entrega, invalidar a cotação.
7. Para entrega, exigir endereço e taxa oficial, não usar preço publicado como total final.
8. Ao ouvir 'sou alérgico a leite', interromper automação e solicitar confirmação da equipe sobre ingredientes e contaminação cruzada, sem prometer segurança.
9. Não confundir 'sim' durante escolha de bebida com confirmação de pedido; somente confirmar depois de orçamento completo **apresentado em mensagem anterior**.
10. Após confirmação, pedido segue para `PENDING_STAFF_REVIEW`, não é registrado como produção autorizada.
11. Guardar separadamente todas as conversas dos dois WhatsApps e impedir eventos duplicados.
12. Em falha de IA/limite de ferramenta, pausar robô e registrar motivo de transferência humana.

## Testes automatizados

No diretório `backend`:

```bash
node --version
npm test
```

A suíte cobre 46 cenários sintéticos de conversa multi-turno no simulador, testes unitários de orçamento e testes HTTP de webhook/canais. O arquivo `test/real-orders-v16.test.mjs` adiciona cenários para **troca de sabor, duas unidades, retirada, mudança de modalidade, isolamento, alergênicos e ciclo de confirmação com API simulada**.

### Fluxo de teste operacional obrigatório (ainda pendente)

- Ambiente de homologação separado da operação e com número(s) de teste.
- Configuração Chatwoot com dois inboxes reais, API de IA e catálogo/preços aprovados.
- Equipe deve enviar mensagens inéditas por WhatsApp em linguagem real, áudio transcrito de forma autorizada e frases incompletas, em horários variados.
- Comparar o **carrinho estruturado** (não só a resposta bonita) com a intenção humana revisada.
- Inserir interrupções, mudanças de ideia, concorrência, mensagens duplicadas, alteração de preço, indisponibilidade, falha de API e transferência humana.
- Revisar falsa confirmação, pedido duplicado e divergência de valor. **Critério crítico = zero ocorrências**, caso contrário bloquear go-live.

## Limitações atuais

- Sem integração ativa com Meta, WhatsApp Business, Chatwoot ou modelo externo.
- Sem sincronização de preço/estoque e cálculo de taxa por endereço; valores oficiais permanecem pendentes.
- Carrinho JSON em volume único é MVP de homologação, não suporta replicação horizontal segura.
- O webhook Chatwoot foi implementado conforme assinatura HMAC do timestamp/corpo bruto documentada; fluxo real ainda depende de credenciais do proprietário.
- Transferência adiciona **nota privada** para a equipe via outbox quando Chatwoot estiver configurado, mas não atribui operador automaticamente. Pausar a IA não substitui uma política operacional de atribuição/turnos.
- Risco residual: a entrega de mensagem externa pode ser repetida se houver queda após envio antes do registro local. Validar idempotência de ponta a ponta no provedor.

**Nunca colocar segredos `.env`, histórico pessoal, dados de clientes ou tokens de API no GitHub público.**
