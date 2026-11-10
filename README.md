# MGEO Campo

App web/PWA para ver as fazendas no mapa, traçar rota, atualizar dados dos talhões em campo,
calcular NDVI e acompanhar indicadores de colheita. Funciona offline depois da primeira abertura.

## Publicar no GitHub Pages (teste)

1. Crie um repositório no GitHub (ex.: `mgeo-campo`).
2. Envie **todo o conteúdo desta pasta** para a raiz do repositório (arraste os arquivos em *Add file > Upload files*, ou `git push`).
3. Em *Settings > Pages*, escolha *Deploy from a branch*, branch `main`, pasta `/ (root)` e salve.
4. Em 1 a 2 minutos o app abre em `https://SEU-USUARIO.github.io/mgeo-campo/`.
5. No celular, abra o link no Chrome (Android) ou Safari (iPhone) e use *Adicionar à tela inicial* para instalar.

> Atenção: repositório público no plano gratuito = dados de fazendas e associados visíveis para qualquer pessoa com o link.
> Para teste fechado, use repositório privado com GitHub Pro/Team, ou Cloudflare Pages / Netlify com senha.

## Rodar no computador

```
python -m http.server 8000
```
e abra `http://localhost:8000`. (Abrir o `index.html` com duplo clique não funciona: o modo offline exige http/https.)

## Estrutura

| Caminho | O que é |
|---|---|
| `index.html`, `css/app.css`, `js/app.js` | o app |
| `sw.js`, `manifest.webmanifest` | modo offline e instalação |
| `data/talhoes.geojson` | base de talhões (CORTE.gpkg convertido para WGS84 e limpo) |
| `vendor/` | Leaflet 1.9.4 e geotiff.js 2.1.3, locais para funcionar sem internet |

## Atualizar a base

- Pelo app: *Dados > Importar base* (GeoJSON de polígonos, WGS84, mesmos campos da base exportada).
- No repositório: substitua `data/talhoes.geojson`. Os aparelhos pegam a versão nova sozinhos na próxima abertura com internet (o app sempre consulta a rede antes do cache). Se algum ficar teimoso: *Dados > Atualizar app e limpar cache*.

Campos: `fid, id, fa, assoc, faz, mun, talhao, area, varied, plantio, dt_colh, corte, tecnico, usina, notas, colhido, prod_t`.

## Serviços externos usados (só quando há internet)

- Imagem de satélite: Esri World Imagery.
- Rotas: servidor público de demonstração do OSRM (bom para teste; para produção, contrate ou hospede um).
- NDVI: Sentinel-2 L2A (10 m) via Earth Search / AWS Open Data, sem chave.
