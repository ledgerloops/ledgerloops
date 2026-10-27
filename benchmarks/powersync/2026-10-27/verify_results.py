#!/usr/bin/env python3
"""Audit primary measurements against the frozen manifest and update hashes."""
import hashlib,json,pathlib,sys
out=pathlib.Path(__file__).resolve().parent
run=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else out/'results'/(out/'results/latest.txt').read_text().strip()
raw=json.loads((run/'raw.json').read_text());manifest=json.loads((out/'fixture/manifest.json').read_text())
assert hashlib.sha256((out/'fixture/fixture.json').read_bytes()).hexdigest()==manifest['sha256']
assert not raw['failures'],raw['failures']
updates={x['field']:x for x in json.loads((out/'expected-updates.json').read_text())}
count=0;incremental=0
for model in ['typed','record_json','collection_json']:
 rows=[r for r in raw['results'] if r['variant']==model]
 assert sorted(r['ordinal'] for r in rows if r['phase']=='warmup')==[0,1,2]
 assert sorted(r['ordinal'] for r in rows if r['phase']=='measured')==list(range(10))
 changes=[]
 for r in rows:
  for phase in ['initial','reopened']:
   v=r['verification'][phase]
   assert (v['sha256'],v['canonicalBytes'],v['issues'],v['notes'])==(manifest['sha256'],manifest['bytes'],21,111)
  assert r['durableMs'] is None
  assert r['subscriptionTriggeredNewWebsocket'] and r['strictEstablishedTransportOnlyMs'] is None
  assert r['wire']['decodedWebsocketPayloadBytes']>=r['wire']['rsocketPayloadDataBytes']>0
  assert r['wire']['tcpReceivedBytes']>=r['wire']['websocketPayloadBytes']>0
  for unit in ['apparent','allocated']:
   assert r['storage']['net'][unit]==r['storage']['total'][unit]-r['storage']['baseline'][unit]
  count+=1;changes+=r['incremental']
 for field in ['title','body']:
  c=[c for c in changes if c['field']==field]
  assert sorted(x['ordinal'] for x in c)==list(range(10))
  for x in c:
   assert x['sourceDeltaUtf8Bytes']==19
   assert x['verification']['sha256']==updates[field]['fixture_sha256_after_this_update']
   assert x['wire']['decodedWebsocketPayloadBytes']>=x['wire']['rsocketPayloadDataBytes']>0
   incremental+=1
 last=next(r for r in rows if r['phase']=='measured' and r['ordinal']==9)
 assert last['verification']['incrementalReopened']['sha256']==updates['body']['fixture_sha256_after_this_update']
print(json.dumps({'verified_initial_transfers':count,'verified_incremental_updates':incremental,'fixture_sha256':manifest['sha256'],'failures':0},indent=2))
