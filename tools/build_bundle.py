"""Gera templates/bundle.json a partir de templates/apresentacao.json, estrutura.json e laminas/*.json.
Rode depois de editar qualquer arquivo de modelo (templates/ ou fontes-templates/):  python tools/build_bundle.py"""
import json, sys
from pathlib import Path
root = Path(__file__).resolve().parents[1]
base = root / 'templates' if (root / 'templates' / 'apresentacao.json').exists() else root / 'fontes-templates'  # pacote Pages: fontes ficam em fontes-templates/
read = lambda p: json.loads(p.read_text(encoding='utf-8-sig'))
cfg, structure = read(base / 'apresentacao.json'), read(base / 'estrutura.json')
slides = {row['id']: read((base / row['file']).resolve()) for row in structure}
missing = [r['section_id'] for r in structure if r['section_id'] not in {s['id'] for s in cfg['sections']}]
if missing: sys.exit('Seção inexistente em apresentacao.json: ' + ', '.join(sorted(set(missing))))
(root / 'templates').mkdir(exist_ok=True)
out = root / 'templates' / 'bundle.json'
out.write_text(json.dumps(dict(config=cfg, structure=structure, slides=slides), ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(f'{out.name}: {len(structure)} lâminas, {len(cfg["sections"])} seções, {out.stat().st_size // 1024} KB')
