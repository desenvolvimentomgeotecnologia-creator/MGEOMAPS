# MGEO PDF – com login, painel ADM e fundo offline

Leitor de GeoPDF gratuito, com GPS em tempo real, login por WhatsApp, painel ADM master e fundo do Google baixável para uso 100% offline.

## 1. Criar o servidor de login (Supabase, plano grátis)

1. Crie uma conta em **supabase.com** e um projeto novo (região: São Paulo).
2. Vá em **SQL Editor**, cole todo o arquivo `supabase/schema.sql` e clique em **Run**.
   Ele cria o banco, as regras de segurança, a regra do lead quente e define os dois ADMs master
   (benati@ e lucas@mgeotecnologia.com).
3. **Authentication → Sign In / Providers**
   - **Email:** ligado. Desligue **Confirm email** (para os logins criados pelo ADM entrarem na hora).
   - **Phone:** ligado. Provedor **Twilio Verify**. Ele envia o código pelo WhatsApp sem configuração extra.
     Cole o Account SID, o Auth Token e o Verify Service SID da sua conta Twilio.
   - Para testar sem gastar: em Phone, cadastre **números de teste** com código fixo.
4. **Authentication → Users → Add user → Create new user**
   - Crie `benati@mgeotecnologia.com` com a senha combinada e marque **Auto Confirm User**.
   - Repita para `lucas@mgeotecnologia.com`.
   - Os dois viram ADM master sozinhos. A senha **não** fica em nenhum arquivo do app.
5. **Project Settings → API**: copie **Project URL** e a chave **anon public** para o arquivo `config.js`.

## 2. Publicar

Suba a pasta inteira no GitHub Pages (ou Netlify). Abra o link no celular e instale:
- **iPhone (Safari):** Compartilhar → *Adicionar à Tela de Início*.
- **Android (Chrome):** *Instalar app*.

## 3. Como funciona

**Cadastro (cliente):** nome, WhatsApp validado por código, perfil, função, município/UF e aceite LGPD.
Depois, no app (Meu perfil): empresa, área e serviços de interesse.

**Lead quente:** usina/fornecedor + gerente/supervisor + acima de 5.000 ha.
Aparece no topo do Painel ADM com o prazo de 48 h para ligar; fica vermelho quando atrasa.

**Painel ADM** (toque nas suas iniciais → Painel ADM):
- Usuários: buscar, filtrar, liberar, bloquear, marcar contatado, tornar ADM, abrir WhatsApp.
- Novo login: cria e-mail + senha já liberado (cliente ou ADM).
- Ajustes: liberar cadastros automaticamente ou só com aprovação; exportar leads em CSV (Excel).

**Offline:** depois do primeiro login com internet, o app abre sem sinal por até 30 dias seguidos
(ajuste `offlineDays` no `config.js`). Quando a internet volta, ele confere se o acesso continua liberado.

**Fundo offline:** Camadas → *Baixar fundo para offline*. Escolha a área (GeoPDF aberto ou tela),
o fundo (Satélite, Híbrido, Mapa) e o detalhe. O app mostra o tamanho em KB/MB antes de baixar
(medido na hora) e lista as áreas baixadas com o espaço que cada uma ocupa.

## Segurança

- Cada cliente só enxerga os próprios dados; só ADMs ativos veem a lista. Isso é garantido pelo banco
  (Row Level Security), não apenas pela tela.
- Cliente não consegue se promover a ADM, se liberar ou mexer em dados de outros (testado).
- Cadastro direto por e-mail fora do app fica *pendente* até um ADM liberar.
- A chave `anon` no `config.js` é pública por natureza; quem protege os dados são as regras do banco.

## Custos

- Supabase: plano grátis atende bem no começo. Projetos grátis são pausados após um período sem uso.
- Twilio (código no WhatsApp): cobra por verificação enviada.
- Blocos do Google: verifique os termos de uso do Google Maps para uso comercial.
