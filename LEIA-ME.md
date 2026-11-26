# MGEO PDF 2.0 – login, modo gerencial e uso offline

Aplicativo + servidor em um só projeto. O servidor guarda cadastros, acessos e estatísticas
em um banco de dados (SQLite) e entrega o app. Os GeoPDFs continuam só no celular de cada usuário.

```
server/     servidor (login, cadastro, senhas, estatísticas, API do modo gerencial)
public/     o aplicativo (mapa, GPS, login, modo gerencial)
Dockerfile  pronto para o EasyPanel
```

## Publicar no EasyPanel (recomendado)

1. **GitHub:** crie um repositório **privado** (ex.: `mgeo-pdf`) e envie esta pasta.
   O `.gitignore` já impede que senhas e o banco de dados subam.
2. **EasyPanel → seu projeto → + Service → App**
   - **Source:** GitHub → escolha o repositório → branch `main`.
   - **Build:** Dockerfile (o EasyPanel detecta sozinho).
3. **Environment** (variáveis): copie do `.env.example` e preencha:
   - `ADMIN_SEED_PASSWORD` = senha inicial dos ADMs benati@ e lucas@ (use uma senha forte).
   - `SMTP_*` = dados do e-mail da empresa, para o “Esqueci minha senha” funcionar.
4. **Mounts → Add Volume:** nome `mgeo-data`, caminho **`/data`**.
   ⚠️ Sem isso, o banco de dados é apagado a cada atualização.
5. **Domains:** adicione o domínio (ex.: `pdf.mgeotecnologia.com`), porta **3000**.
   ⚠️ Se você definir a variável `PORT` (ex.: 80), o domínio precisa usar essa mesma porta.
   Também funciona num caminho do domínio do portal: `https://portalmgeo.com.br/mgeopdf` →
   `http://bots_mgeopdf:80/` (o prefixo `/mgeopdf` é tratado pelo app; outro prefixo: variável `BASE_PATH`).
   O EasyPanel gera o HTTPS sozinho.
6. **Deploy.** Abra o domínio, entre com benati@ ou lucas@ e escolha o modo.

Para atualizar depois: envie as mudanças ao GitHub e clique em **Deploy** (ou ligue o auto deploy).

## Rodar no computador (teste)

```
npm install
ADMIN_SEED_PASSWORD=TesteForte123 npm start
```
Abra http://localhost:3000

## O que tem

- **Splash com o logo MGEO** ao abrir.
- **Login** com e-mail e senha, **Esqueci minha senha** (código de 6 números por e-mail) e
  **Criar conta**: nome, e-mail, senha, WhatsApp, perfil, função, município/UF,
  “Onde conheceu o MGEO PDF?”, aceite dos **Termos de Uso** e autorização de contato (LGPD).
- **Login do Portal MGEO:** quem tem usuário ativo no Portal MGEO entra com o mesmo e-mail e a
  mesma senha do portal (conferidos no Supabase do portal, como no serviço de mapas dos clientes).
  - Papéis **admin** e **comercial** do portal entram no **modo gerencial**; os outros, só no MGEO PDF.
    Mude com a variável `PAPEIS_GERENCIAL` (ex.: `admin,comercial,gestor`).
  - Usuário inativo ou excluído no portal não entra.
  - Na primeira entrada pelo portal, a pessoa ganha (ou tem vinculado pelo e-mail) um cadastro no
    MGEO PDF, para as estatísticas. A partir daí vale só a senha do portal, que se troca no portal.
  - No log aparece `[MGEO] login pelo Portal MGEO: email (papel ...)`.
  - O “Criar conta” do app continua aberto para quem não tem usuário no portal.
- **ADM ao entrar escolhe:** Modo gerencial ou Modo MGEO PDF (e pode trocar a qualquer hora).
- **Modo gerencial:** usuários, novos cadastros, ativos por dia/semana/mês, acessos, tempo de uso,
  mapas importados, downloads offline, origem dos usuários, perfil, função, área, estados,
  municípios, aparelhos, últimos acessos, ranking de uso, leads quentes com prazo de 48 h,
  ficha de cada pessoa com WhatsApp/ligar/e-mail, anotações da equipe comercial,
  liberar/bloquear, tornar ADM, gerar nova senha, excluir dados (LGPD) e exportar para Excel.
- **Offline:** depois do primeiro login, abre sem internet por até 30 dias. O uso feito offline
  é guardado e enviado ao servidor quando a internet volta.

## Antes de publicar

Preencha nos arquivos `public/termos.html` e `public/privacidade.html`:
`[RAZÃO SOCIAL DA MGEO]`, `[CNPJ]`, `[ENDEREÇO COMPLETO]`, `[E-MAIL DE CONTATO DA MGEO]` e `[CIDADE/UF DA SEDE]`.
Vale uma revisão do jurídico.

## Segurança

Senhas com scrypt (nunca em texto), sessão em cookie HttpOnly/Secure, limite de tentativas de login,
código de recuperação com validade de 15 min e 5 tentativas, proteção contra CSRF, cabeçalhos de
segurança (CSP, HSTS, X-Frame-Options), checagem de ADM no servidor e nenhuma senha no código.
