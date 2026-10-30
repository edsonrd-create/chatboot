# Auto Atendimento Express — áudio bidirecional por WhatsApp (homologação)

## Integração preservada

O projeto existente usa **Baileys** (WhatsApp por QR, canal não oficial) em `src/wa-qr.mjs`, o motor de pedidos em `src/ai.mjs` + `src/core.mjs` e o backend em `src/server.mjs`. As duas sessões QR (slots 1 e 2) continuam com identificadores e diretórios de autenticação separados. Nenhum conector é substituído. **A Meta Cloud API permanece um caminho distinto, sem autoatendimento por voz nesta implementação**.

## Fluxo implementado

```text
WhatsApp QR / Baileys
  ├─ texto novo -> regras de pedidos existentes -> resposta de texto
  └─ áudio novo -> permissão BOT + whitelist -> download limitado
       -> FFmpeg (formato, decodificação, mono Opus, duração <= 180 s)
       -> Gemini STT em pt-BR, com vocabulário de sabores reais
       -> mesmo motor de pedidos/FAQ do texto e mesma sessão/cart
       -> Gemini TTS (voz sintética com identificação)
       -> FFmpeg PCM/WAV -> OGG Opus -> Baileys PTT no mesmo slot e contato
       └─ se resposta trouxer valores, confirmação ou pagamento:
          cópia textual enviada antes do áudio para conferência
```

- Mensagens `fromMe`, histórico de sincronização, grupos, status e eventos sem conteúdo não passam pela IA.
- Deduplicação ocorre antes da transcrição (reduz custo e elimina respostas repetidas no mesmo processo).
- Uma fila por conversa mantém a ordem; limitação global restringe chamadas simultâneas.
- Quando o operador assume uma conversa, o envio da IA é cancelado após o processamento, antes de chamar o transporte.
- Se o áudio não é decodificável, excede o limite, não tem fala compreensível ou não pode ser transcrito: marca a conversa como `HUMAN`/`WAITING` e envia uma orientação breve, sem inventar conteúdo.
- Se o TTS falhar: informa por escrito que não conseguiu gerar voz, sem simular áudio. Salva o código da falha para o painel.
- Não confirma pedido, pagamento, valor, desconto ou prazo sem as validações do motor atual; a escrita no PDV segue desativada.
- Ao enviar a primeira voz, identifica que o atendimento é de uma assistente virtual, sem usar imitação de pessoa real.
- A transcrição usa o dicionário dos **sabores cadastrados** como referência, mas não inventa nomes ausentes da gravação.
- O texto da transcrição e as mídias aceitas são armazenados na central conforme o sistema atual; uma política de retenção e acesso LGPD precisa ser homologada antes de produção.

## Limites e disponibilidade

- Máximo por mensagem: **12 MiB** (mídia de entrada) e **180 segundos**.
- Formatos admitidos pelo normalizador: OGG, Opus, WAV, MP3/MPEG, MP4/M4A, AAC, FLAC, WebM, AIFF. O arquivo deve ter assinatura reconhecível e decodificar pelo FFmpeg.
- A transcrição é enviada ao Gemini como **audio/ogg**, com a chave armazenada exclusivamente no backend.
- O retorno é convertido para **OGG/Opus**, enviado como `ptt:true` pelo Baileys.
- Antes do processamento o sistema verifica `WA_QR_ENABLED`, `WA_QR_AUTOREPLY`, conexão do slot, lista de teste, chave Gemini e modo `BOT` da conversa.
- Falhas de conexão/síntese/decodificação geram códigos estáveis como `FFMPEG_UNAVAILABLE`, `AUDIO_TOO_LONG`, `AUDIO_INAUDIBLE`, `AUDIO_TTS_FAILED` e `QR_SEND_FAILED`. Nenhum áudio, token ou transcrição privada é incluído nos logs técnicos.
- O Dockerfile já contém `apk add --no-cache ffmpeg`. Se Railway usar outro builder em vez do **Dockerfile**, a disponibilidade não é garantida.

## Configuração Railway — usar somente número de teste

No serviço Railway que realmente executa `native/src/server.mjs`, configure em **Variables** e aplique o deploy, depois confirme que a branch e o commit implantados correspondem a esta mudança. Valores de exemplo:

```dotenv
FREE_PREVIEW_MODE=false
WA_QR_ENABLED=true
WA_QR_AUTOREPLY=true
WA_QR_VOICE=true
WA_QR_TEST_NUMBERS=55SEUNUMERODETESTE
AI_PROVIDER=gemini
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_TRANSCRIBE_MODEL=gemini-3.5-flash-lite
GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts
GEMINI_TTS_VOICE=Kore
FFMPEG_PATH=ffmpeg
```

**Não publicar chaves em GitHub**. Configure uma nova `GEMINI_API_KEY` como segredo do Railway; se alguma chave foi enviada em conversa ou captura, revogue/substitua a anterior. Também são necessários `APP_PUBLIC_URL` (HTTPS real), `APP_SECRET`, `ADMIN_PASSWORD`, `DATA_FILE` e volume persistente para `wa-auth/` e mídias. Evite múltiplas instâncias usando a mesma sessão Baileys.

**Ativação não foi realizada pelo GitHub**: alterar o código não liga `WA_QR_VOICE` no Railway. Não habilitar para todos os clientes antes de completar os testes reais.

## Verificação no painel

1. Faça login em `/painel` e acesse **WhatsApp QR**.
2. Clique em **Verificar voz e FFmpeg**. O endpoint autenticado `GET /api/audio/health` mostra se o binário `ffmpeg` e o encoder `libopus` estão disponíveis, além de indicar se Gemini STT/TTS está configurado. Nenhuma chave ou conteúdo privado é retornado.
3. Verifique que `GET /api/qr/status` indica o slot conectado e a autorresposta configurada. Uma conversa antiga em modo humano só entra em BOT após clicar em **Ativar IA nesta conversa**.
4. Envie do número de teste um áudio perguntando por um sabor existente. Confirme: mensagem de entrada, transcrição, resposta pelo motor de pedidos, nota de voz reproduzível e histórico correto.
5. Intercale texto, áudio, texto e áudio no mesmo contato, nos dois números separadamente.
6. Teste mensagens duplicadas, áudio de 181 segundos, arquivo incompatível, ruído sem fala, falha de TTS, mudança para humano durante o processamento e reinício com sessão persistida.
7. Confira o **tempo de resposta**, a tarifação das chamadas Gemini e os logs de erros seguros, sem conteúdo do cliente.

## Restrições da homologação

- Baileys é um cliente de protocolo **não oficial** e pode sofrer bloqueios ou incompatibilidade com mudanças do WhatsApp. Para operação crítica/produção, avaliar migração para a Meta WhatsApp Cloud API (que exige outro fluxo para receber e enviar áudios).
- Os testes automatizados usam dependências simuladas e FFmpeg local; **não comprovam envio real a clientes** nem custo/latência na conta Gemini.
- A fila atual por conversa é em memória; reinício do processo durante a síntese pode deixar uma mensagem recebida sem resposta. Outbox durável, política de retenção, métricas de falhas e validação operacional permanecem itens necessários para produção.
- Nenhum pedido é gravado no PDV.
