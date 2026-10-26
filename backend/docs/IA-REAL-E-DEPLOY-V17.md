# Guto Bot V1.7 — Inteligência real e homologação

## Diagnóstico
A página estática em GitHub Pages usa um **simulador local por regras** e não consegue chamar modelos em segurança: chaves de API nunca podem ficar no navegador. O backend já tinha suporte à API de IA, mas, sem chave, usava FAQ básica facilmente confundida com IA real. O webhook também continha uma variável indefinida no handoff humano.

## Correções concluídas
- `POST /api/simulate`: exige `OPENAI_API_KEY` no servidor. Sem chave retorna HTTP 503 — não finge resposta de IA.
- `POST /api/ai/check`: teste administrativo opt-in que faz chamada real ao modelo e informa se respondeu. **Pode gerar cobrança pelo provedor da IA.**
- UI do backend informa se a chave está ausente ou configurada; não a revela.
- Webhooks Chatwoot de dois inboxes sem IA configurada encaminham à equipe com nota privada e sem tentativa de venda automatizada.
- Corrigido erro `previouslyHuman is not defined`.
- Fila de saída Chatwoot separada da fila de entrada: falhas no envio não travam a leitura de novas mensagens.
- Detecta `RENDER_EXTERNAL_URL` em hospedagem Render para validação de origem e cookies seguros.

## Como colocar IA real online
1. Abra o [Deploy to Render](https://render.com/deploy?repo=https://github.com/edsonrd-create/chatboot) do projeto. Leia o custo indicado antes de confirmar: **plano Starter e armazenamento persistente podem gerar cobrança**.
2. O `render.yaml` publica o backend de homologação com domínio HTTPS e disco persistente (instância única). Ele **não ativa WhatsApp automaticamente**.
3. Insira, somente no formulário seguro da Render, `ADMIN_PASSWORD` exclusiva com 12+ caracteres e `OPENAI_API_KEY` da conta de API do provedor. `APP_SECRET` é gerado pela Render; não copie chaves para GitHub, ChatGPT ou HTML.
4. Após a implantação, abra o endereço `*.onrender.com` disponibilizado pelo provedor, e teste `/health`.
5. Entre no painel com a senha definida; abra **Simulador IA → Verificar conexão com a IA**. A verificação faz chamada real e pode consumir saldo. Só depois envie perguntas livres.
6. Cadastre preços de pizzas, bebidas, taxa por entrega e regras da meia a meia a partir de fonte comercial validada. O sistema bloqueia confirmar pedido sem orçamento completo.
7. Somente após homologação, conecte os dois inboxes Chatwoot/WhatsApp com canais oficiais e autorização apropriada.

## Limitações importantes
- **GitHub Pages continua sendo prévia estática sem IA**. Para IA de verdade é preciso abrir o painel HTTPS do backend.
- Backend armazena dados em JSON no disco; adequado apenas à homologação controlada com **uma réplica**. Operação comercial exige PostgreSQL, filas duráveis e backups.
- Nenhuma chave nem conta Render está vinculada neste código; não houve deploy em conta de hospedagem a partir deste repositório.
- Testes automatizados usam respostas de IA simuladas. A verificação real precisa ocorrer no serviço implantado; teste de unidade não prova disponibilidade externa.
- Não utilizar com clientes reais sem controle de acesso, validação de preço e testes ponta a ponta.
