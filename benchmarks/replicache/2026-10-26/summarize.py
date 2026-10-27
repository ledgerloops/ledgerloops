#!/usr/bin/env python3
import json, math, pathlib, statistics, sys
folder=pathlib.Path(__file__).resolve().parent
name=sys.argv[1] if len(sys.argv)>1 else 'measured'
data=json.loads((folder/(name+'-results.json')).read_text())
def stats(values):
    v=sorted(values)
    return dict(n=len(v),p50=statistics.median(v),p95_nearest_rank=v[math.ceil(.95*len(v))-1],maximum=max(v),minimum=min(v))
summary={}
for model in ['records','shared','collections']:
    rows=[r for r in data['results'] if r['model']==model and not r['warmup']]
    if not rows:continue
    summary[model]={'measured_runs':len(rows),'key_count':rows[0]['key_count'],'stages':{}}
    for index,kind in enumerate(['initial','issue_title','note_body']):
        stages=[r['stages'][index] for r in rows]
        summary[model]['stages'][kind]={
          'observable_ms':stats([s['observable_ms'] for s in stages]),
          'pull_ms':stats([s['pull_ms'] for s in stages]),
          'persistence_notification_ms':stats([s['persistence_notification_ms'] for s in stages]),
          'durable_ms':None,
          'received_protocol_bytes':stats([s['received_protocol_bytes'] for s in stages]),
          'storage_total_apparent_bytes':stats([s['storage_total']['apparent_bytes'] for s in stages]),
          'storage_total_allocated_bytes':stats([s['storage_total']['allocated_bytes'] for s in stages]),
          'storage_net_apparent_bytes':stats([s['storage_net']['apparent_bytes'] for s in stages]),
          'storage_net_allocated_bytes':stats([s['storage_net']['allocated_bytes'] for s in stages]),
          'full_live_and_reopened_verification':all(s['correctness']['full_content_equal'] and s['reopened']['full_content_equal'] for s in stages)}
    summary[model]['storage_baseline_apparent_bytes']=stats([r['baseline']['apparent_bytes'] for r in rows])
    summary[model]['storage_baseline_allocated_bytes']=stats([r['baseline']['allocated_bytes'] for r in rows])
    summary[model]['service_disk']=rows[0]['service_disk']
out={'quantiles':'p50 median; p95 nearest rank; n=10 => sample maximum; exploratory small sample',
     'durability':'Default relaxed IndexedDB; internal persistence notification observed; power-loss durable timing unavailable',
     'fixture_sha256':data['results'][0]['stages'][0]['reopened']['sha256'],'models':summary}
(folder/(name+'-summary.json')).write_text(json.dumps(out,indent=2)+'\n')
for m,v in summary.items():
    s=v['stages'];print(m, 'keys',v['key_count'],'initial observable p50/p95',s['initial']['observable_ms']['p50'],s['initial']['observable_ms']['p95_nearest_rank'],
      'persist p50',s['initial']['persistence_notification_ms']['p50'],'wire',[s[k]['received_protocol_bytes']['p50'] for k in s],
      'disk baseline/total/net',[v['storage_baseline_apparent_bytes']['p50'],s['initial']['storage_total_apparent_bytes']['p50'],s['initial']['storage_net_apparent_bytes']['p50']])
