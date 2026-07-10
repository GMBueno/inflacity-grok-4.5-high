#!/usr/bin/env python3
"""Parse SIDRA/IBGE CSV exports into public/data/ipca.json"""
import csv, re, json, io
from pathlib import Path
from collections import OrderedDict

ROOT = Path(__file__).resolve().parents[1]

MONTHS_PT = {
    'janeiro': 1, 'fevereiro': 2, 'março': 3, 'marco': 3, 'abril': 4, 'maio': 5, 'junho': 6,
    'julho': 7, 'agosto': 8, 'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12,
}

def parse_month(s):
    s = s.strip().lower()
    m = re.match(r'([a-záéíóúç]+)\s+(\d{4})', s)
    if not m:
        return None
    mon = MONTHS_PT.get(m.group(1))
    if not mon:
        return None
    return f"{m.group(2)}-{mon:02d}"

def clean_name(s):
    return re.sub(r'^\d+\.', '', s.strip()).strip()

def parse_old_format(path, want_var='mensal'):
    text = Path(path).read_text(encoding='utf-8-sig')
    lines = text.splitlines()
    target = {
        'mensal': 'Variação mensal',
        'ano': 'acumulada no ano',
        '12m': 'acumulada em 12 meses',
    }[want_var]
    i = next((i for i, L in enumerate(lines) if 'Variável' in L and target in L), None)
    if i is None:
        return {}, []
    reader = list(csv.reader(io.StringIO('\n'.join(lines[i + 1:i + 8]))))
    month_row, cat_row = reader[1], reader[2]
    data_row = next((r for r in reader[3:] if r and r[0] in ('Brasil', 'brasil')), None)
    if not data_row:
        return {}, []
    months, month_positions = [], []
    for j, cell in enumerate(month_row):
        if cell and parse_month(cell):
            months.append(parse_month(cell))
            month_positions.append(j)
    cats_per_month = []
    for mi, start in enumerate(month_positions):
        end = month_positions[mi + 1] if mi + 1 < len(month_positions) else len(cat_row)
        cats_per_month.append([(j, clean_name(cat_row[j])) for j in range(start, end) if cat_row[j].strip()])
    result = {}
    for month, cats in zip(months, cats_per_month):
        for col_j, name in cats:
            try:
                val = float(data_row[col_j].replace(',', '.'))
            except Exception:
                try:
                    val = float(data_row[col_j + 1].replace(',', '.'))
                except Exception:
                    continue
            result.setdefault(name, {})[month] = val
    return result, months

def parse_7060(path):
    text = Path(path).read_text(encoding='utf-8-sig')
    lines = text.splitlines()
    block = []
    for L in lines:
        if L.startswith('"Fonte:') or L.startswith('Fonte:'):
            break
        block.append(L)
    reader = list(csv.reader(io.StringIO('\n'.join(block))))
    month_row_idx = next(i for i, r in enumerate(reader) if any(parse_month(c) for c in r if c))
    month_row = reader[month_row_idx]
    data_start = month_row_idx + 3
    months, month_positions = [], []
    for j, cell in enumerate(month_row):
        if cell and parse_month(cell):
            months.append(parse_month(cell))
            month_positions.append(j)
    result = {}
    for r in reader[data_start:]:
        if not r or not r[0] or r[0].startswith('Fonte') or r[0] in ('Notas', '...'):
            break
        name = clean_name(r[0])
        if not name:
            continue
        for month, start in zip(months, month_positions):
            def getv(idx, row=r):
                if idx >= len(row):
                    return None
                s = row[idx].strip()
                if not s or s in ('...', '-', 'x', 'X'):
                    return None
                try:
                    return float(s.replace(',', '.'))
                except Exception:
                    return None
            mensal = getv(start)
            if mensal is not None:
                result.setdefault(name, {})[month] = mensal
    return result, months

NAME_MAP = {
    'Leite pasteurizado': 'Leite',
    'Leite longa vida': 'Leite',
    'Índice geral': None,
    'Alimentação no domicílio': None,
    'Vinho': None,
    'Microcomputador': 'Computador',
    'Computador pessoal': 'Computador',
}

def normalize(name):
    if name in NAME_MAP:
        return NAME_MAP[name]
    if 'vinho' in name.lower():
        return None
    return name

def merge_series(*dicts):
    out = {}
    for d in dicts:
        for name, series in d.items():
            n = normalize(name)
            if n is None:
                continue
            out.setdefault(n, {}).update(series)
    return out

def compute_index(monthly_series, all_months):
    """Price index: start at 100, then compound every monthly rate we have.

    Base is the level *before* the first observation. Jul/2006's variation
    (e.g. Tomate −18.66%) is applied like every other month — we use the full
    history rather than pinning the first month to 100 and skipping its rate.
    """
    idx = {}
    level = 100.0
    started = False
    for m in all_months:
        if m in monthly_series:
            level = level * (1 + monthly_series[m] / 100.0)
            started = True
            idx[m] = round(level, 4)
        elif started:
            idx[m] = round(level, 4)
    return idx

def rolling_12m(index_series, all_months):
    out = {}
    month_to_idx = {m: i for i, m in enumerate(all_months)}
    for m in all_months:
        if m not in index_series:
            continue
        mi = month_to_idx[m]
        if mi < 12:
            continue
        prev = all_months[mi - 12]
        if prev not in index_series:
            continue
        out[m] = round((index_series[m] / index_series[prev] - 1) * 100, 4)
    return out

GROUP_THEMES = {
    'Alimentação e bebidas': 'food', 'Habitação': 'housing', 'Artigos de residência': 'home',
    'Vestuário': 'clothing', 'Transportes': 'transport', 'Saúde e cuidados pessoais': 'health',
    'Despesas pessoais': 'personal', 'Educação': 'education', 'Comunicação': 'comms',
}
ITEM_THEMES = {
    'Arroz': 'rice', 'Feijão - preto': 'beans', 'Macarrão': 'pasta', 'Batata-inglesa': 'potato',
    'Tomate': 'tomato', 'Carnes': 'meat', 'Ovo de galinha': 'egg', 'Leite': 'milk', 'Pão francês': 'bread',
    'Azeite de oliva': 'olive_oil', 'Café moído': 'coffee', 'Cerveja': 'beer',
    'Alimentação fora do domicílio': 'restaurant', 'Aluguel residencial': 'rent',
    'Condomínio': 'condo', 'Taxa de água e esgoto': 'water', 'Detergente': 'detergent',
    'Gás de botijão': 'gas', 'Energia elétrica residencial': 'energy', 'Computador': 'computer',
    'Ônibus urbano': 'bus', 'Passagem aérea': 'plane', 'Gasolina': 'gasoline', 'Etanol': 'ethanol',
    'Óleo diesel': 'diesel', 'Plano de saúde': 'health_plan', 'Empregado doméstico': 'domestic',
    'Cigarro': 'cigarette', 'Educação': 'education',
}

def pack(entities, themes, all_months):
    items = []
    for name, monthly in entities.items():
        theme = themes.get(name, 'default')
        idx = compute_index(monthly, all_months)
        r12 = rolling_12m(idx, all_months)
        monthly_arr, cum_arr, r12_arr = [], [], []
        for m in all_months:
            monthly_arr.append(monthly.get(m))
            cum_arr.append(round(idx[m] - 100, 4) if m in idx else None)
            r12_arr.append(r12.get(m))
        items.append({
            'name': name, 'theme': theme,
            'monthly': monthly_arr, 'cumulative': cum_arr, 'rolling12': r12_arr,
        })
    return items

def main():
    g1, _ = parse_old_format(ROOT / 'grupos/tabela2938.csv')
    g2, _ = parse_old_format(ROOT / 'grupos/tabela1419.csv')
    g3, _ = parse_7060(ROOT / 'grupos/tabela7060.csv')
    s1, _ = parse_old_format(ROOT / 'selecionados/tabela2938_31_selecionados.csv')
    s2, _ = parse_old_format(ROOT / 'selecionados/tabela1419_31_selecionados.csv')
    s3, _ = parse_7060(ROOT / 'selecionados/tabela7060_32_selecionados.csv')
    grupos = merge_series(g1, g2, g3)
    selecionados = merge_series(s1, s2, s3)
    all_months = sorted({m for d in [grupos, selecionados] for s in d.values() for m in s})
    group_order = list(GROUP_THEMES.keys())
    grupos_ordered = OrderedDict((k, grupos[k]) for k in group_order if k in grupos)
    payload = {
        'months': all_months,
        'baseDate': all_months[0],
        'endDate': all_months[-1],
        'groups': pack(grupos_ordered, GROUP_THEMES, all_months),
        'items': pack(OrderedDict(sorted(selecionados.items())), ITEM_THEMES, all_months),
        'source': 'IBGE/SIDRA — IPCA (tabelas 2938, 1419, 7060)',
    }
    out = ROOT / 'public/data/ipca.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
    print(f'Wrote {out} ({out.stat().st_size/1024:.1f} KB)')
    print(f'{len(all_months)} months, {len(payload["groups"])} groups, {len(payload["items"])} items')

if __name__ == '__main__':
    main()
