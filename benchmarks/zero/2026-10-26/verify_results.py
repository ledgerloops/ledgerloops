#!/usr/bin/env python3
"""Audit exported raw evidence for the required repetitions and full-fixture hashes."""
import json,hashlib
from pathlib import Path
root=Path(__file__).resolve().parent
fixture=json.loads((root/'fixture/fixture.json').read_bytes())
def encoded(x):return json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def digest(x):return hashlib.sha256(encoded(x)).hexdigest()
original=digest(fixture)
assert original=='9b8f0b8e52345b95d0bd3434d125ef2dc1a688ad537c0c3a1ccc8348981a101a'
changed=json.loads(json.dumps(fixture));changed['issues'][0]['title']+=' SYNTHETIC-TITLE-UPDATE-44';titlehash=digest(changed)
changed['notes'][0]['body']+=' SYNTHETIC-BODY-UPDATE-44';changedhash=digest(changed)
summary=json.loads((root/'summary.json').read_text())
assert set(summary['variants'])=={'typed','record','collection'}
for variant,s in summary['variants'].items():
 raw=json.loads((root/'results'/s['raw_result']).read_text());assert raw['measurement_schema']==2
 v=next(v for v in raw['variants'] if v['variant']==variant)
 assert v['status']=='complete'
 assert all('Sec-WebSocket-Extensions:' not in h for h in v['handshakes'])
 assert sum(not r['measured'] for r in v['runs'])==3
 assert sum(r['measured'] for r in v['runs'])==10
 assert v['sender_replica_verified']['sha256']==original
 for r in v['runs']:
  for key in ['correctness','reopened']:
   assert r[key]['verified'] and r[key]['sha256']==original and r[key]['bytes']==415448
  assert r['durable_ms'] is None and r['persistence_transaction_ms']>0 and r['readable_ms']>0
  assert r['wire']['received']>415448 and r['transport_bytes']['received']>=r['wire']['received']
  d=r['receiver_storage']
  for side in ['baseline','total']:
   assert set(d[side]['parts'])>={'IndexedDB','Local Storage','Session Storage','WebStorage'}
   for measure in ['apparent_bytes','allocated_bytes']:assert d[side][measure]==sum(p[measure] for p in d[side]['parts'].values())
  for measure in ['apparent_bytes','allocated_bytes']:assert d['net'][measure]==d['total'][measure]-d['baseline'][measure]
 assert [u['correctness']['sha256'] for u in v['updates']]==[titlehash,changedhash]
 assert v['incremental_reopened']['verified'] and v['incremental_reopened']['sha256']==changedhash
 assert v['summary']['readable_ms']['n']==10
 assert v['summary']['readable_ms']['p95_nearest_rank']==v['summary']['readable_ms']['max']
 print(variant+': 3 warmups, 10 measured full offline reopens, 2 updates, final offline reopen; storage scopes and byte arithmetic verified')
print('All required exported evidence passed')
