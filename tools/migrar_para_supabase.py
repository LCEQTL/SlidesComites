"""Migra a apresentação do servidor local (SQLite + pasta uploads) para o Supabase.

Aproveita o conteúdo já preenchido: para cada lâmina que existe na estrutura nova (templates/), copia o conteúdo,
o título, o status "pronto"/"não incluir" e as referências da ata. Lâminas que não existem mais na estrutura nova
são listadas no final (não são copiadas). Imagens e PDFs são enviados ao Storage com o mesmo nome (hash).

Uso (na raiz do projeto local, com o Python do projeto):
  python tools/migrar_para_supabase.py --dados data --url https://SEU-PROJETO.supabase.co ^
         --anon-key SUA_CHAVE_ANON --email equipe@exemplo.com --senha SENHA_DA_EQUIPE [--simular]
Use --simular para só conferir o que seria migrado, sem enviar nada.
"""
import argparse, copy, json, mimetypes, re, sqlite3, sys, urllib.error, urllib.request
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]

def empty_content():
    return dict(rows=[], bullets=[], text='', image=None, photos=[], visits_agencies='', visits_partners='', resolved='', chart_without=[], chart_with=[], pdf=None, font_size=0, projection_last=False)

def load_template():
    """Estado inicial a partir de templates/bundle.json (mesma lógica do site)."""
    bundle = json.loads((ROOT / 'templates' / 'bundle.json').read_text(encoding='utf-8'))
    cfg, slides, sections = bundle['config'], {}, []
    names = {s['id']: s['name'] for s in cfg['sections']}
    for row in bundle['structure']:
        s = copy.deepcopy(bundle['slides'][row['id']])
        s.update(id=row['id'], title=row['title'], owners=row['owners'], included=row['included'], section_id=row['section_id'], revision=0, excluded=False, ready=False, updated_at=None, updated_by=None, generic=False, ata_refs=[], ata_ref_sig={}, ata_review=[])
        s['content'] = {**empty_content(), **s.get('content', {})}; slides[row['id']] = s
        sec = next((x for x in sections if x['id'] == row['section_id']), None)
        if sec is None: sec = dict(id=row['section_id'], name=names[row['section_id']], slides=[]); sections.append(sec)
        sec['slides'].append(row['id'])
    return dict(schema_version=2, settings=cfg['settings'], users=cfg['users'], wallets=cfg['wallets'], presentation_types=cfg['presentation_types'], sections=sections, slides=slides, mode='editing', event=None, history=[], generation=0)

def http(method, url, headers, body=None):
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = r.read(); return r.status, (json.loads(raw) if raw and raw[:1] in b'[{"0123456789-tfn' else raw)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try: return e.code, json.loads(raw)
        except Exception: return e.code, raw.decode('utf-8', 'ignore')

def read_doc(db, name):
    row = db.execute('SELECT body FROM documents WHERE name=?', (name,)).fetchone()
    return json.loads(row[0]) if row else None

def urls_in(obj):
    if isinstance(obj, dict):
        for v in obj.values(): yield from urls_in(v)
    elif isinstance(obj, list):
        for v in obj: yield from urls_in(v)
    elif isinstance(obj, str) and re.fullmatch(r'/uploads/[a-f0-9]{64}\.(webp|pdf)', obj): yield obj

def rewrite(obj, prefix):
    if isinstance(obj, dict): return {k: rewrite(v, prefix) for k, v in obj.items()}
    if isinstance(obj, list): return [rewrite(v, prefix) for v in obj]
    if isinstance(obj, str) and re.fullmatch(r'/uploads/[a-f0-9]{64}\.(webp|pdf)', obj): return prefix + obj.rsplit('/', 1)[-1]
    return obj

def merge(old, new):
    """Estrutura nova + conteúdo antigo (por id). Retorna (estado, lista de ids não migrados)."""
    lost = []
    for id, o in old['slides'].items():
        n = new['slides'].get(id)
        if n is None and o.get('generic') and o['section_id'] in {s['id'] for s in new['sections']}:
            n = copy.deepcopy(o); new['slides'][id] = n
            next(s for s in new['sections'] if s['id'] == o['section_id'])['slides'].append(id)
        elif n is None:
            if any([o['content'].get('rows'), o['content'].get('image'), o['content'].get('photos'), o['content'].get('text'), o['content'].get('bullets'), o['content'].get('pdf')]): lost.append(f"{id} ({o['title']})")
            continue
        keep_template = n['layout'] == 'works'  # a marcação de projeção do gráfico vem do template
        n['content'] = {**empty_content(), **n['content'], **{k: v for k, v in o['content'].items() if not (k == 'projection_last' and keep_template)}}
        if not keep_template: n['content']['projection_last'] = False
        for k in ['title', 'ready', 'excluded', 'ata_refs', 'ata_ref_sig', 'ata_review']:
            if k in o: n[k] = copy.deepcopy(o[k])
        n['revision'] = o.get('revision', 0) + 1; n['updated_at'] = o.get('updated_at'); n['updated_by'] = o.get('updated_by')
    new['mode'] = 'editing'; new['event'] = None; new['generation'] = old.get('generation', 0) + 1
    return new, lost

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--dados', default=str(ROOT / 'data'), help='pasta data do projeto local')
    ap.add_argument('--url'); ap.add_argument('--anon-key'); ap.add_argument('--email'); ap.add_argument('--senha')
    ap.add_argument('--bucket', default='media'); ap.add_argument('--simular', action='store_true')
    a = ap.parse_args()
    data = Path(a.dados); dbfile = data / 'apresentacoes.sqlite3'
    if not dbfile.is_file(): sys.exit(f'Banco não encontrado: {dbfile}')
    with sqlite3.connect(dbfile) as db:
        old, previous = read_doc(db, 'current'), read_doc(db, 'previous')
    if not old: sys.exit('O banco local está vazio.')
    state, lost = merge(old, load_template())
    files = sorted({u for u in urls_in([state, previous])})
    missing = [u for u in files if not (data / 'uploads' / u.rsplit('/', 1)[-1]).is_file()]
    print(f'Lâminas na estrutura nova: {len(state["slides"])} | com conteúdo migrado: {sum(1 for s in state["slides"].values() if s["content"]["rows"] or s["content"]["image"] or s["content"]["photos"] or s["content"]["text"] or s["content"]["bullets"] or s["content"]["pdf"])} | arquivos: {len(files)}')
    if lost: print('NÃO migradas (não existem mais na estrutura nova):\n  - ' + '\n  - '.join(lost))
    if missing: print('Arquivos ausentes na pasta uploads (serão ignorados):', ', '.join(missing))
    if a.simular: print('Simulação concluída. Nada foi enviado.'); return
    if not all([a.url, a.anon_key, a.email, a.senha]): sys.exit('Informe --url, --anon-key, --email e --senha (ou use --simular).')
    base = a.url.rstrip('/'); prefix = f'{base}/storage/v1/object/public/{a.bucket}/'
    st, auth = http('POST', f'{base}/auth/v1/token?grant_type=password', {'apikey': a.anon_key, 'Content-Type': 'application/json'}, json.dumps({'email': a.email, 'password': a.senha}).encode())
    if st != 200: sys.exit(f'Login da equipe falhou ({st}): {auth}')
    h = {'apikey': a.anon_key, 'Authorization': 'Bearer ' + auth['access_token']}
    for i, u in enumerate(files, 1):
        name = u.rsplit('/', 1)[-1]
        if not (data / 'uploads' / name).is_file(): continue
        st, res = http('POST', f'{base}/storage/v1/object/{a.bucket}/{name}', {**h, 'Content-Type': mimetypes.guess_type(name)[0] or 'application/octet-stream', 'x-upsert': 'false'}, (data / 'uploads' / name).read_bytes())
        if st not in (200, 201) and not (st in (400, 409) and 'exist' in json.dumps(res).lower()): sys.exit(f'Falha ao enviar {name} ({st}): {res}')
        print(f'  arquivo {i}/{len(files)} ok', end='\r')
    print()
    st, rows = http('GET', f'{base}/rest/v1/kv?key=eq.current&select=version', h)
    if st != 200: sys.exit(f'Falha ao ler o Supabase ({st}): {rows}. O schema.sql foi executado?')
    expected = rows[0]['version'] if rows else 0
    if expected and input('Já existe uma apresentação no Supabase. Substituir? (digite SIM) ') != 'SIM': sys.exit('Cancelado.')
    writes = {'current': rewrite(state, prefix), 'previous': rewrite(previous, prefix) if previous else None, 'official': None}
    st, res = http('POST', f'{base}/rest/v1/rpc/kv_commit', {**h, 'Content-Type': 'application/json'}, json.dumps({'p_expected': expected, 'p_writes': writes}, ensure_ascii=False).encode())
    if st not in (200, 201): sys.exit(f'Falha ao gravar ({st}): {res}')
    print('Migração concluída. Abra o site e confira.')
main() if __name__ == '__main__' else None
