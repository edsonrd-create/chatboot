# Guto Bot V1.7 — ativação de IA real e homologação

## Problema confirmado

O HTML estático do GitHub Pages não tem servidor. O simulador visual usa regras locais e **não possui conexão com modelos de IA**. O backend V1.6 já possuía suporte à API de IA, mas, sem `OPENAI_API_KEY`, mostrava FAQ básica, o que era fácil confundir com atendimento inteligente. Além disso, no processamento de transferência humana havia uma variável indefinida `previouslyHuman` que impedia registrar o handoff.

## Correções V1.7

- A rota administrativa `POST /api/simulate` exige chave de IA; responde HTTP 503 quando ela não está configurada. Não disfarça respostas programadas como IA real.
- A rota administrativa `POST /api/ai/check` faz uma chamada simples e autorizada à API de modelo para testar chave, rede e modelo. **A chamada pode consumir saldo da API**. Não envia dados de clientes.
- O painel informa configuração ausente, chave presente ainda não verificada, e resultado da verificação. A chave não aparece no navegador.
- O processamento de mensagens dos dois inboxes encaminha para a equipe quando a chave da IA não está presente ou quando o modelo falha; gera nota interna e não tenta vender sem modelo.
- A variável de transferência foi corrigida e o caso foi incluído em teste HTTP de ponta a ponta com webhooks assinados, eventos em disco e canais isolados.
- A fila de saída (Chatwoot) foi separada do processamento de entrada, evitando que falhas de envio atrasem a leitura de novas mensagens.
- O endereço público em hospedagem Render é detectado usando `RENDER_EXTERNAL_URL` caso `APP_PUBLIC_URL` não esteja definido.

## Como publicar backend para teste com IA de verdade

1. Entre no serviço [Render](https://dashboard.render.com/) com sua conta. O blueprint do repositório `chatboot` pode ser iniciado pelo botão do README. Revise **o custo do plano Starter e do volume persistente antes de confirmar**.
2. Faça a implantação usando o `render.yaml` da raiz. Ele publica `backend/` e o **painel com login do backend**, não o HTML do GitHub Pages.
3. Quando o Render pedir variáveis secretas, informe **somente no painel seguro da Render**: `ADMIN_PASSWORD` (mínimo 12 caracteres) e `OPENAI_API_KEY` (chave própria do serviço de IA). O `APP_SECRET` é gerado automaticamente.
4. Aguarde a implantação e abra o endereço HTTPS fornecido pelo Render. Confirme que `/health` responde `{ "ok": true }`. Faça login com sua senha administrativa.
5. Na seção **Simulador IA**, clique em **Verificar conexão com a IA** (faz uma chamada real e cobrada conforme o provedor). Se funcionar, envie perguntas livres sobre sabores, ingredientes e quantidades.
6. Ainda não cadastre valores de venda como reais até confirmar preços e taxas no painel. Sem preço válido o sistema **bloqueia confirmação do pedido**.
7. A integração Chatwoot com dois WhatsApps só deverá ser habilitada **depois dos testes de homologação**, consentimento operacional e configuração de inboxes autorizados.

## Limitações do piloto

- Persistência atual é **arquivo JSON em volume**, exclusivamente para 1 instância, não banco PostgreSQL multi-instância.
- Não há deploy automático em conta Render realizado pelo ChatGPT; o responsável deve revisar e confirmar a criação do serviço.
- Não há chave OpenAI incluída no código e não há número de WhatsApp configurado.
- O HTML estático da raiz pode continuar acessível via GitHub Pages, mas não se tornará IA real: para testar conversa com modelo, use o painel HTTPS do backend.
- O teste unitário com resposta simulada da API não comprova disponibilidade da IA externa; a verificação de conexão precisa ser executada após implantar.

## Segurança

Não insira tokens ou senhas no chat, GitHub, arquivos estáticos, mensagens, telas públicas nem histórico de atendimento. Recomendamos isolamento de ambiente de testes, controle de acesso, retenção adequada e nunca habilitar venda automática sem validação de preços.

## Tests

`cd backend && npm test` após clonar o repositório. O workflow de GitHub Actions executa a suíte sem custos ou chamadas reais ao modelo.
