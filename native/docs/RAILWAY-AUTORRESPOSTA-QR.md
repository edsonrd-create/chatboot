# Railway — diagnosticar autorresposta por WhatsApp QR

**Importante:** o QR via Baileys é uma integração NÃO oficial. A Meta pode restringir contas ou sessões. Use um número de teste/ambiente controlado até homologar; a integração por API Cloud oficial é o caminho de produção recomendado.

## Causa da mensagem anterior

A mensagem "Resposta automática desligada no servidor (WA_QR_AUTOREPLY=true)" era produzida pela rota `POST /api/thread/mode` quando a variável não era `true` **no processo Node que respondia à requisição**. O painel antigo exibia o status global `autoReplyEnabled:false` mesmo com o QR configurado. Além disso, conversas antigas permaneciam em modo humano.

Agora o backend:
- interpreta com tolerância a aspas/espaços `WA_QR_AUTOREPLY=true`, mas nunca ativa sozinho se a variável estiver ausente;
- mostra em `GET /api/qr/status` as propriedades `enabled`, `autoReply`, `autoReplyConfigured`, `aiConfigured`, `active`, `slots[].replyReady`, `blockers`, `help`;
- permite **Ativar IA nesta conversa** nos threads antigos de QR, depois de validar os requisitos;
- mantém conversas assumidas por operador em modo humano; salvar preferências gerais não reativa conversas silenciosamente;
- registra um código seguro `qrLastBlocker` quando uma mensagem não pode ser respondida;
- não habilita a API Meta automática nem a escrita no PDV.

## Configuração do serviço Railway

No projeto Railway indicado, abra o **serviço web que executa `native/src/server.mjs`**, ambiente correto (por exemplo `production` ou `homologation`). Confira **Settings > Source**: a branch deve conter a correção da feature `feature/guto-bot-nativo-meta-v2` (ou um commit que recebeu as alterações equivalentes). Confira se o **Root Directory** é `/native` e o start command é `npm start` (se o repositório for a origem).

Na aba **Variables** desse MESMO serviço, configure (sem aspas no editor):

```dotenv
NODE_ENV=production
FREE_PREVIEW_MODE=false
WA_QR_ENABLED=true
WA_QR_AUTOREPLY=true
WA_QR_VOICE=false
AI_PROVIDER=gemini
GEMINI_MODEL=gemini-3.5-flash-lite
WA_QR_TEST_NUMBERS=55SEUNUMERODETESTE
```

A chave `GEMINI_API_KEY` deve ficar apenas no gerenciador de segredos do Railway. Uma chave compartilhada em conversa deve ser revogada e substituída. Mantenha `APP_SECRET`, `ADMIN_PASSWORD` (12+ caracteres), `APP_PUBLIC_URL` (HTTPS real) e `DATA_FILE` configurados e protegidos. **Não altere `APP_SECRET` de forma irrefletida**, pois outros tokens podem estar criptografados usando esse segredo.

**Persistência:** os arquivos de autenticação QR `wa-auth/slot-1` e `wa-auth/slot-2` precisam sobreviver a redeploys. Idealmente mantenha o diretório que contém `DATA_FILE` e `wa-auth` em um volume persistente com acesso exclusivo, por exemplo `DATA_FILE=/data/state.json` e volume montado em `/data`. Backup e criptografia do volume são recomendados. Não execute duas réplicas Baileys usando o mesmo diretório de sessão simultaneamente.

A alteração de variáveis na Railway só entra em vigor após **Apply/Deploy**. Acompanhe se o deploy novo usou o commit e o ambiente corretos.

## Teste em homologação

1. Faça login no painel administrativo do Guto Bot implantado no Railway.
2. Acesse **WhatsApp QR**. Verifique se `autoReplyConfigured=true` e se o canal está conectado. `active=true` significa que os requisitos gerais foram atendidos em pelo menos um canal.
3. Confira `GET /api/qr/status` no navegador autenticado. Os códigos `blockers` identificam o que falta. **Não é necessário mostrar a chave ao suporte.**
4. Envie do número listado em `WA_QR_TEST_NUMBERS` uma mensagem de texto NOVA para o WhatsApp de testes. Um contato novo deve nascer em `BOT`.
5. Para conversa antiga em `HUMAN`, abra a conversa e clique **Ativar IA nesta conversa**. Só as mensagens seguintes serão respondidas.
6. Se aparecer `AI_API_KEY` ou `AI_PERMISSION`, confira chave/provedor/modelo. Se aparecer `WA_QR_TEST_NUMBERS`, confira o telefone com DDI 55 e a identificação usada pela sessão. Se aparecer `WHATSAPP_DISCONNECTED`, reconecte o QR e verifique o volume.
7. Confirme os registros com as categorias `[QR IA]` e `[QR envio]`, sem coletar números, mensagens privadas ou segredos. Mantenha o PDV sem escrita até homologação integral.

## Importante sobre a publicação

Um push no GitHub **não garante** que o Railway tenha atualizado o serviço. É obrigatório verificar **Settings > Source**, branch/commit do deploy, variáveis efetivas e status do serviço. Quando houver acesso à conta Railway pela integração, será possível validar diretamente os logs e a URL; sem essa conexão não é possível afirmar que já responde em produção.
