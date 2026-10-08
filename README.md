# TV-UNI · Central de telas

Painel web para organizar vídeos e sincronizar a reprodução nas TVs das filiais.

## Configuração do Supabase

1. Em `scripts/supabase-config.js`, preencha `SUPABASE_URL` com a Project URL e `SUPABASE_ANON_KEY` com a chave `anon`/`publishable` do projeto.
2. Nunca coloque `service_role` ou uma secret key no navegador. As tabelas e o bucket usam RLS para limitar as gravações a usuários autenticados.
3. No Supabase, crie o usuário administrador em **Authentication → Users → Add user**. O painel entra com e-mail e senha do Supabase Auth.
4. Publique os arquivos do site em hospedagem HTTPS, como GitHub Pages. O painel usa Supabase Auth; o player `tv.html` abre sem login.
5. Para atualizar uma instalação que já usa as tabelas antigas, execute uma vez o arquivo `supabase-playlists-migration.sql` no SQL Editor do Supabase. Ele cria playlists e itens e migra os vídeos atuais para “Playlist padrão”.

O bucket `tv-videos` é público para permitir que as TVs carreguem os vídeos diretamente. Não envie conteúdo confidencial. O painel seleciona a playlist a transmitir; a página `playlist.html` cria e organiza playlists, recebe upload e configura a transição de cada vídeo. Alterações em `playlists`, `playlist_items` e `playback_state` são recebidas em tempo real pelo Supabase Realtime.

## Estrutura

- `index.html`, `playlist.html`, `connect.html`, `login.html`, `tv.html`: páginas do painel, playlists, conexão das TVs, autenticação e player.
- `styles/`: tokens, componentes e estilos de cada tela.
- `scripts/api.js`: adaptador Supabase para Auth, Database, Storage e Realtime.
- `scripts/supabase-config.js`: Project URL e chave pública do projeto.
- `scripts/dashboard.js`, `scripts/playlist.js`, `scripts/connect.js`, `scripts/login.js`, `scripts/tv.js`: interações das telas.
- `supabase-playlists-migration.sql`: migração para playlists nomeadas e transições individuais.
- `assets/images/`: logos da UNI para fundos claros e escuros.
- `server.js`: servidor local simples para pré-visualizar o site.

## Pré-visualização local

1. Instale Node.js 18 ou mais recente.
2. Na pasta do projeto, rode `npm start` (ou `node server.js`).
3. Abra `http://localhost:8080`.

Para abrir o player em outras TVs, publique o site em hospedagem acessível por elas. O endereço do player é o endereço do site seguido de `tv.html`.
