# Guto Bot V1.8 — Duplo WhatsApp e painel estilo WhatsApp Web

## O que já está implementado

- Tela própria [whatsapp.html](../../whatsapp.html) com dois canais, lista de conversas, histórico, busca, filtro de não lidas, respostas manuais e detalhes. No GitHub Pages usa apenas conversas **fictícias**, sem acesso aos WhatsApps.
- O backend atende a tela na rota **/inbox** com login obrigatório e API protegida:
  - `GET /api/inbox/channels`: informa configuração e confirma se os IDs dos dois inboxes existem no Chatwoot;
  - `GET /api/inbox/conversations?inboxId=<id>`: lista conversas de um único número;
  - `GET /api/inbox/conversations/:id/messages?inboxId=<id>`: lista mensagens públicas após verificar que a conversa pertence ao número;
  - `POST /api/inbox/conversations/:id/reply?inboxId=<id>`: permite resposta manual e pausa o bot na conversa antes de enviar.
- O token Chatwoot fica **somente no backend**. O frontend não armazena chaves da Meta nem tokens. Mensagens internas privadas não são exibidas.
- A IA continua no backend, isolada da tela demonstrativa. A resposta manual passa a conversa ao atendente.

## Conectar os dois números existentes com QR oficial

1. Acesse o **Chatwoot** com permissões de administrador. Vá em **Settings → Inboxes → Add Inbox → WhatsApp → Connect with WhatsApp Business**.
2. Escolha **conectar um WhatsApp Business app existente (Coexistence)** para o **número 1**.
3. Se a Meta oferecer **Scan QR code**, use somente o QR apresentado pelo fluxo oficial e leia com o aplicativo de telefone conforme as instruções. Se oferecer código de verificação/mensagem oficial, siga esse método. **Não é possível garantir que o QR aparecerá para todas as contas.**
4. Registre o Inbox ID criado e faça o mesmo para o **número 2**, em outra caixa de entrada.
5. Configure no backend (segredos somente no servidor): `CHATWOOT_BASE_URL`, `CHATWOOT_API_TOKEN`, `CHATWOOT_WEBHOOK_SECRET`, `CHATWOOT_ACCOUNT_ID`, `CHATWOOT_INBOX_1`, `CHATWOOT_INBOX_2`. Para a IA real, `OPENAI_API_KEY` em ambiente privado.
6. Abra **/inbox** no backend hospedado. Confirme que ambas as caixas aparecem como validadas pelo Chatwoot. Faça envio e recebimento de teste com outros números, alternando os canais, antes de liberar clientes reais.

**Avisos:** a Meta decide se o número é elegível à coexistência. A conexão pode desvincular dispositivos WhatsApp Web já vinculados; mensagens antigas não são importadas automaticamente. Não remova ou migre os números atuais sem verificar o impacto.

Documentação oficial: https://app.chatwoot.com/hc/user-guide/articles/1752129193-how-to-use-whatsapp-embedded-signup

## Situação atual e limites

- **Preview no GitHub Pages:** exibe uma interface semelhante ao WhatsApp Web, com clientes fictícios e respostas manuais simuladas. Não gera QR nem conecta números reais.
- **Backend no GitHub:** rotas HTTP, autenticação, validação de inbox e integração com Chatwoot disponíveis no código. Ainda não foi implantado em hospedagem real com credenciais de produção.
- O QR de autorização **só existe dentro do fluxo Meta/Chatwoot**, não em HTML gerado pelo projeto.
- Não há sincronização em tempo real por WebSocket nesta versão: use o botão Atualizar. Mídias, áudio e histórico antigo exigem trabalhos adicionais.
- O motor de pedidos exige orçamento e conferência antes de criar pedidos; não deve enviar automaticamente à cozinha.

## Testes

`cd backend && npm test` — regressão geral e isolamento de canais. Pipeline: [Guto Bot backend tests](../../actions/workflows/guto-backend-tests.yml).

Nunca cadastre tokens, dados de clientes, senhas ou QR codes confidenciais no GitHub público.
