# Programa de treinamento comportamental — Guto Bot

## Objetivo

Fazer o atendente virtual entender **como pessoas realmente pedem pizzas pelo WhatsApp**: mensagens curtas e fora de ordem, gírias, abreviações, áudios transcritos, dúvidas, interrupções, alterações de sabores, vários produtos e cancelamentos. Não se trata de repetir frases decoradas. O critério é **reter a intenção e os detalhes corretos do pedido em múltiplos turnos**, sem inventar itens ou valores.

**Status atual:** treinamento por instruções e exemplos (*few-shot*) no `src/training.mjs`, motor de demonstração em `public/simulator.js` e testes em `test/simulator-realistic.test.mjs`. Não houve ajuste de pesos (*fine-tuning*) nem validação com mensagens pessoais reais. Simulador local usa regras, enquanto atendimento real conectado usa IA com ferramentas no backend.

## Representação de um pedido

Registrar por conversa identificada por **conta + número WhatsApp + ID da conversa**: quantidades, tamanho, fatias, sabores (até 2), borda, adicionais, observações, bebida, retirada/entrega, endereço, pagamento, cotação, confirmação e histórico auditável. Os dois números nunca compartilham carrinhos.

## 12 comportamentos mínimos

1. **Saudação + pedido no mesmo texto:** extrair o pedido, sem responder apenas "boa noite".
2. **Português informal:** "manda", "me vê", "faz", "calabreza", "frango catupa", "2 grandes".
3. **Informações incompletas:** perguntar somente tamanho ou sabor ausente.
4. **Meio a meio em mensagens diferentes:** manter a primeira metade até receber a segunda.
5. **Múltiplas pizzas:** tratar "2 grandes de calabresa e 1 média portuguesa" como itens distintos.
6. **Modificação:** "troca calabresa por portuguesa" deve alterar sabor, não criar outra pizza.
7. **Remoção:** "tira a Coca" retira bebida e preserva pizza.
8. **Adicionais e observações:** anotar e avisar que cozinha e preço exigem validação.
9. **Combos:** entender composição publicada, perguntar sabores e conferir regras da promoção vigente; nunca vender somente por preço do anúncio.
10. **Dúvidas durante pedido:** responder sobre ingredientes e retornar naturalmente ao carrinho.
11. **Confirmação:** bloquear "confirmo" se orçamento atualizado não foi mostrado e aprovado explicitamente.
12. **Fidelidade, alergias e histórico:** não inventar saldo nem prometer segurança alimentar; consultar o sistema autorizado ou transferir ao humano.

## Como executar testes que reproduzem conversas

Use Node.js >= 22:

```bash
npm test
```

O arquivo `training/realistic-cases.json` contém **33 roteiros de conversas sintéticas** (com várias mensagens, não apenas entradas isoladas). O teste lê cada mensagem, executa o motor **real do simulador** sem substituir suas respostas por respostas pré-programadas, e inspeciona o carrinho resultante e a resposta final. Também testa isolamento de dois canais, confirmações repetidas e endereços distintos.

O objetivo dos casos não é provar que o bot entende todo português. Casos que falharem devem gerar correções e novos cenários. Quando o backend e uma conta de IA estiverem configurados, faça testes E2E adicionais por meio do Chatwoot em ambiente isolado, com dois números de teste e operadores, antes de liberar clientes.

### Exemplos do atendimento esperado

**Mensagem**: “boa noite, me vê 2 grande meia calabreza meia frango catupa e coca 2 litro”.

**Interpretação desejada**: duas pizzas grandes com dois sabores cada e uma bebida *somente se o tamanho/variante da Coca-Cola for inequívoco*; nunca tomar “2 litros” como duas bebidas.

**Mensagem seguinte**: “troca uma calabresa por portuguesa”.

**Regra**: se houver várias pizzas iguais, perguntar *qual* pizza deseja alterar, pois não dá para decidir automaticamente.

**Mensagem**: “tá quanto pra entregar aqui no Jardim?”

**Regra**: solicitar endereço completo e consulta de taxa real, não inventar valor com base apenas no bairro.

**Mensagem**: “meu filho tem alergia a leite, faz sem queijo?”

**Regra**: não garantir segurança apenas por retirar ingredientes; solicitar confirmação direta da cozinha sobre alergênicos e contaminação cruzada.

## Portões para produção

- Integração oficial com os 2 números e identificação de cada inbox.
- Respostas reais via Chatwoot com webhook validado, deduplicação e entrega de respostas monitorada.
- Catálogo e disponibilidade sincronizados; preço de pizza, combo e taxa calculados pelo backend.
- Testes completos com variações nunca vistas pelo motor de regras, por telefone de teste em cada número.
- Revisão humana de pedidos no MVP, com fallback automático em falhas da IA.
- Zero pedidos falsos, duplicados, com valor divergente ou sem confirmação.
- Medir taxa de pedidos compreendidos corretamente, taxa de perguntas desnecessárias, custo por conversa, latência e erros por categoria.

## Cuidados com dados reais

Casos sintéticos não contêm dados pessoais. Para transformar conversas reais em conjunto de avaliação, só utilizar dados autorizados, anonimizados com remoção de telefones, endereços, CPF, nomes, identificadores e comprovantes. Controlar retenção e acesso.
