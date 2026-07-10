# InflaCidade

Visualização 3D interativa da inflação brasileira (IPCA/IBGE) como um mundo-cidade.

Cada categoria de preços vira um **prédio** cuja altura representa o quanto aquele grupo ou item ficou mais caro desde a data-base (jul/2006) — ou a variação em 12 meses.

## Rodar localmente

```bash
npm install
npm run dev
```

Abra o endereço indicado (padrão `http://localhost:5173`).

Build de produção:

```bash
npm run build
npm run preview
```

Regenerar o JSON a partir dos CSVs SIDRA:

```bash
npm run data
```

## Controles

| Input | Ação |
|-------|------|
| Mouse arrastar | Orbitar câmera |
| Scroll | Zoom |
| WASD / setas | Mover |
| Space | Subir |
| Ctrl / Q | Descer |
| Shift | Correr |
| Clique no prédio | Detalhes |

HUD: teleportar entre **Grupos** e **Selecionados**, ciclo **Manhã / Tarde / Noite**, modo **Σ base** vs **12 meses**, timeline de data.

## Dados

CSVs exportados do SIDRA/IBGE (100% offline em runtime):

- **Grupos** (9): `grupos/tabela2938.csv`, `tabela1419.csv`, `tabela7060.csv`
- **Selecionados** (~29 itens; Vinho excluído): `selecionados/*`

O script `scripts/build-data.py` consolida as séries mensais, calcula índice acumulado (base 100) e variação em 12 meses → `public/data/ipca.json`.

## Stack

- [Three.js](https://threejs.org/) — mundo 3D
- Vite — bundler / dev server
- Dados IBGE/SIDRA — IPCA

## Conceito do mapa

Duas cidades em mapa contínuo, separadas por rio sinuoso com afluentes e lagoas, ponte navegável, parque, vegetação, grade de avenidas, colinas e falésias. Prédios temáticos (energia, combustíveis, alimentos, saúde, etc.) com andares, janelas e adereços de topo.
