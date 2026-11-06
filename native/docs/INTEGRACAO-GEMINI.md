# Guto Bot V2 — Google Gemini (homologação)

## Status e limites

O backend do Guto Bot tem integração direta com o **Google Gemini API (generateContent)**, sem Chatwoot. O Gemini interpreta as mensagens e pode pedir ao motor determinístico do Guto Bot para consultar o cardápio, adicionar/alterar pizzas, registrar entrega ou retirada, verificar pendências e montar um orçamento. **Não pode inventar preços, confirmar pagamentos, criar pedidos no PDV ou ativar o atendimento automaticamente.** O código não conecta WhatsApps enquanto a homologação estiver bloqueada.

**A versão do Render Free com `FREE_PREVIEW_MODE=true` é uma prévia pública de layout: o laboratório de IA é desabilitado e não deve receber dados reais.** Não adicione `GEMINI_API_KEY` a essa prévia: o segredo ficaria armazenado em ambiente inadequado para operação e a API continuará bloqueada.

## Credencial segura

**NUNCA** inclua uma chave Gemini no GitHub, em um arquivo `.env` versionado, em `index.html`, no JavaScript do navegador ou em mensagens de suporte. Uma credencial enviada em chat ou captura deve ser **revogada e substituída** na conta de origem.

1. Acesse o [Google AI Studio — chaves da API](https://aistudio.google.com/api-keys), identifique a chave que foi compartilhada e revogue/restrinja o acesso. Gere uma chave nova para este serviço.
2. Em uma **hospedagem privada de homologação com backend persistente**, configure variáveis de ambiente no gerenciador de segredos (não em arquivos públicos):
   - `AI_PROVIDER=gemini`
   - `GEMINI_API_KEY=(nova chave privada, sem expor no repositório)`
   - `GEMINI_MODEL=gemini-3.5-flash-lite` (pode alterar para `gemini-3.8-flash` conforme quota/preço e acesso da conta)
   - `FREE_PREVIEW_MODE=false` **somente** se a hospedagem possuir autenticação administrativa e persistência adequada, com as demais proteções do backend
   - `ADMIN_PASSWORD`, `APP_SECRET`, `APP_PUBLIC_URL` e `DATA_FILE` seguros e configurados.
3. Reinicie o serviço. O painel `/painel` exibe o provedor e o estado de **Teste real: pendente**; as chaves nunca são retornadas ao navegador.
4. Em ambiente administrativo restrito, execute **Testar IA**. A rota `POST /api/ai/test` chama o Gemini de verdade e retorna `ok:true` **somente quando a API responde com texto**, sem validar vendas.
5. Teste conversas pelo laboratório `POST /api/simulate`. O modelo usa o histórico e as ferramentas de carrinho do backend. Confirme que as informações retornadas correspondem ao cardápio e que nenhum pedido entrou no PDV.
6. Mantenha `autoReplyEnabled=false` até homologar o desempenho real, os dois números, as políticas de preços, pagamento e a escrita idempotente no PDV.

## Diagnóstico técnico

- `401/403`: chave inválida, revogada, restrição de projeto/permissões ou API não autorizada.
- `404`: modelo indisponível para a chave, região ou versão da API.
- `429`: quota, limites de taxa ou créditos.
- `400`: parâmetros, modelo ou formato de chamada incompatível.
- Resposta vazia: bloqueada e reportada como erro; não apresentar texto programado como se fosse resposta do Gemini.
- O Google AI Studio normalmente emite chaves de API com formato específico. **Não confiar somente no prefixo**; apenas uma chamada real autenticada verifica a credencial.

O sistema utiliza `https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent` com cabeçalho privado `x-goog-api-key`. Os testes automatizados usam chave falsa e respostas HTTP simuladas; **não comprovam autenticidade da chave real nem conexão com WhatsApp ou PDV**.

Referências: [API Gemini](https://ai.google.dev/api/generate-content), [Modelos Gemini](https://ai.google.dev/gemini-api/docs/models), [Segurança de chaves](https://ai.google.dev/gemini-api/docs/api-key).

## Homologação exigida antes de liberar para clientes

- [ ] Nova chave criada e **teste real da API Gemini aprovado** em hospedagem privada.
- [ ] Diálogos inéditos avaliados, inclusive erros ortográficos, meio a meio, combos, trocas de sabores, cancelamentos e restrições alimentares.
- [ ] Orçamentos verificados contra o PDV vigente, sem valores inventados.
- [ ] Confirmação do cliente em mensagem posterior ao orçamento completo.
- [ ] Ambos os números oficiais testados fim a fim; isolamento entre clientes.
- [ ] Persistência, logs e recuperação comprovados antes de operar.
- [ ] Integração de criação de pedidos no PDV com autenticação, idempotência, revisão e testes.
