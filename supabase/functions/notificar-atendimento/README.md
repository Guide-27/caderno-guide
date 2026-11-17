# notificar-atendimento — e-mail quando alguém pede atendimento

Esta função manda um e-mail para a equipe da Guide toda vez que uma conversa
do chat muda para o status **`pendente`** (ou seja, quando o cliente/visitante
clica em **"Falar com atendimento"**).

Fluxo: cliente clica → `chat_conversas.status` vira `pendente` → um **Database
Webhook** do Supabase chama esta função → ela lê as últimas mensagens e envia o
e-mail com um **link direto para a conversa** no painel de atendimento.

---

## Passo a passo (uma vez só)

### 1. Ter o Supabase CLI
Se ainda não tem, instale: <https://supabase.com/docs/guides/cli>. Depois, na
pasta do projeto:

```bash
supabase login
supabase link --project-ref fkbvwcppbjlodtnjrmbw
```

### 2. Criar a chave de e-mail (Resend)
1. Crie uma conta grátis em <https://resend.com>.
2. Em **API Keys**, gere uma chave (começa com `re_...`).
3. (Recomendado) Em **Domains**, verifique um domínio seu para poder enviar de
   um endereço do tipo `atendimento@seudominio.com`. Sem domínio verificado, o
   Resend só entrega para o seu próprio e-mail e usando o remetente de teste.

### 3. Guardar os segredos no Supabase
Nunca coloque a chave no código. Rode:

```bash
supabase secrets set RESEND_API_KEY=re_sua_chave_aqui
supabase secrets set NOTIFICAR_EMAIL_DESTINO=lucas.2002louenco@gmail.com
supabase secrets set APP_BASE_URL=https://caderno-guide.vercel.app
supabase secrets set EMAIL_REMETENTE="Guide Atendimento <atendimento@seudominio.com>"
```

> `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já existem automaticamente no
> ambiente da função — não precisa setar.
> `APP_BASE_URL` é o endereço do painel (para o link do e-mail). Troque pelo seu
> domínio real da Vercel se for diferente.
> `EMAIL_REMETENTE` é opcional; sem ele usa o remetente de teste do Resend.

### 4. Publicar a função
```bash
supabase functions deploy notificar-atendimento
```

### 5. Ligar o Database Webhook (é o "gatilho")
No painel do Supabase → **Database → Webhooks → Create a new hook**:
- **Table:** `chat_conversas`
- **Events:** marque apenas **Update**
- **Type:** *Supabase Edge Functions*
- **Edge Function:** `notificar-atendimento`
- **Method:** `POST`
- Salve.

Pronto. A própria função só age quando o status **passa a ser** `pendente`
(ignora os outros updates), então não manda e-mail repetido.

---

## Testar
1. Abra o chat (no painel ou no site), mande uma mensagem e clique em
   **"Falar com atendimento"**.
2. Em segundos deve chegar o e-mail em `NOTIFICAR_EMAIL_DESTINO`.
3. Se não chegar, veja os logs:
   ```bash
   supabase functions logs notificar-atendimento
   ```
   Causas comuns: `RESEND_API_KEY` não setada, ou remetente sem domínio
   verificado (nesse caso o Resend só entrega para o e-mail dono da conta).

## Fase 2 (depois)
Quando o robô de respostas (IA) sair do stub, ele provavelmente virará outra
Edge Function, para a chave do modelo não ficar exposta no navegador. Esta
função de notificação continua igual.
