# Guto Bot — Guto Express 🍕

**Protótipo de atendimento humanizado com testes realistas de conversa**, base informativa de sabores e combos da Pizzaria Guto Express. O objetivo é transformar solicitações informais de clientes em pedidos corretos, sem adivinhar preços ou confirmar vendas indevidamente.

## Prévia

Abra [index.html](index.html) localmente ou publique a versão estática usando o workflow [Publicar demonstração](.github/workflows/deploy-pages.yml). **É preciso ativar o GitHub Pages uma vez** em [Settings → Pages](https://github.com/edsonrd-create/chatboot/settings/pages): em **Build and deployment → Source**, escolha **GitHub Actions**. Depois abra [Actions → Publicar demonstração](https://github.com/edsonrd-create/chatboot/actions/workflows/deploy-pages.yml) e clique **Run workflow** na branch `main`. Com o deploy concluído com sucesso, teste em **https://edsonrd-create.github.io/chatboot/**.

A implantação publica **somente o arquivo `index.html` estático**, sem o backend e sem dados privados. Os dois números WhatsApp e o Chatwoot ainda não estão conectados.

Em **Simulador do bot**, escreva como um cliente falaria no WhatsApp. O simulador entende várias mensagens em sequência, mantém um carrinho, reconhece alguns apelidos de sabores, complementa meio a meio, registra pagamento/endereço fornecidos, faz perguntas quando a bebida ou troca não está clara, preserva contexto entre dúvidas, e bloqueia conclusão sem cotação. É um **motor local baseado em regras**, não IA generativa.

O seletor **WhatsApp 01 / WhatsApp 02** usa sessões isoladas para treinamento. Nenhum número real está conectado neste repositório.

## Testar frases de clientes

Experimente:

- `boa noite, manda uma grande meia calabreza meia frango catupa`
- `bota uma coca` → `2 litros`
- `me vê duas grandes de calabresa` → `troca calabresa por portuguesa` (precisa perguntar qual)
- `o que vai na Portuguesa?`
- `uma grande calabresa com coca 2 litros, pago pix, Rua das Flores 123 Colombo`
- `cancela tudo`
- `confirmo` (sem orçamento: bloquear)
- `preciso falar com atendente` (pausar o simulador)

Para executar os testes automatizados, instale **Node.js 22 ou superior** e rode:

```bash
npm test
```

Há **26 testes no repositório**, exercitando exatamente o motor embutido no `index.html`. A suíte completa do backend de desenvolvimento, distribuída separadamente, foi executada com **70 testes locais aprovados**, incluindo 46 roteiros sintéticos de diálogos multi-turno. As duas suítes não substituem homologação com clientes.

## Documentos e catálogo

- [Cardápio público de referência](data/cardapio-publico.json) — 74 sabores, 7 anúncios de combo/oferta, 20 bebidas.
- [Treinamento realista do atendente](training/TREINAMENTO-REALISTA.md) — intenções, situações, ambiguidades e critérios de aceite.
- [Testes automatizados](tests/realistic.test.mjs) — regressão sobre o mesmo motor usado pela prévia.
- [Diretrizes de atendimento e segurança](docs/ATENDENTE-INTELIGENTE.md).

A fonte pública consultada foi [gutoexpress.com.br/cardapio](https://www.gutoexpress.com.br/cardapio?dvc=mobile&ed_mobile_iframe=1), porque o endereço solicitado `pedir.to/gutoexpress` não pôde ser acessado diretamente. Os preços anunciados **não são cotações válidas para checkout**, e não há sincronização com disponibilidade ou taxas de entrega.

## Implantação real — ainda pendente

A prévia não recebe WhatsApp, não faz pagamento e não cria pedidos. Para operação real é necessário:

1. Integrar os dois números existentes ao Chatwoot/Meta oficialmente, com verificação de coexistência.
2. Implantar o backend de IA em serviço HTTPS com autenticação, deduplicação, logs e persistência.
3. Sincronizar cardápio, regras comerciais, taxas, horários e disponibilidade com fonte autorizada.
4. Usar ferramentas transacionais para orçamento e exigir resumo **atualizado e confirmado em mensagem posterior**.
5. Manter aprovação humana, transferência de conversa e validação real por dois números antes da produção.

**Privacidade:** este repositório é público. Nunca publique tokens, senhas, chaves de IA, mensagens de clientes, números de telefone ou endereços reais.

## Backend humanizado V1.6

A implementação técnica do chatbot de homologação agora está na pasta [backend](backend/). Ela é separada do `index.html` estático publicado pelo GitHub Pages.

**Atualizações:** troca de sabor com novo resumo, alteração de somente uma unidade em duas pizzas iguais, retirada sem frete, proteção para alergênicos, nota privada de transferência no Chatwoot e teste de confirmação com API de IA simulada.

Para executar o backend em ambiente Node.js 22+:

```bash
cd backend
cp .env.example .env
# Configure ADMIN_PASSWORD e APP_SECRET localmente; nunca publique o .env
npm test
npm start
```

O sistema só processa pedidos livres usando IA quando um provedor de modelo for conectado com uma chave válida. **Ainda não há Chatwoot/WhatsApps reais, preço atualizado, pagamento ou produção conectados.** Não usar para vender antes dos testes de homologação descritos em [backend/docs/HOMOLOGACAO-V16.md](backend/docs/HOMOLOGACAO-V16.md).

**Testes GitHub Actions:** [Guto Bot backend tests](../../actions/workflows/guto-backend-tests.yml). A suíte antiga do simulador também é executada quando o HTML é alterado.


## Atendimento com IA real (backend V1.7)

**Atenção:** o `index.html` do GitHub Pages usa um simulador estático de regras, não um modelo de IA. Para testar conversas humanizadas com modelo real, é preciso implantar o [backend](backend/) em hospedagem HTTPS com chave de API guardada no servidor. Sem chave, a API de simulação não finge inteligência: responde que a IA não está configurada.

[**Preparar implantação de homologação no Render**](https://render.com/deploy?repo=https://github.com/edsonrd-create/chatboot) — exige revisão e confirmação na conta Render. O plano Starter com disco pode ter custo; consulte preço antes de confirmar.

[Manual de IA real e publicação](backend/docs/IA-REAL-E-DEPLOY-V17.md). A autenticação é pelo painel do backend publicado, não pelo GitHub Pages. A integração de WhatsApp real continuará desligada até homologação.
