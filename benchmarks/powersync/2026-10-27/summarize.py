#!/usr/bin/env python3
import json,pathlib,statistics,math,sys
out=pathlib.Path(__file__).resolve().parent
run=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else out/'results'/(out/'results/latest.txt').read_text().strip()
raw=json.loads((run/'raw.json').read_text())
def summary(v):
 s=sorted(v)
 return {'n':len(s),'p50':statistics.median(s),'p95_nearest_rank':s[math.ceil(.95*len(s))-1],'max':max(s),'min':min(s)} if s else None
res={}
for variant in raw['environment']['variants']:
 rows=[r for r in raw['results'] if r['variant']==variant and r['phase']=='measured']
 x={'measured_n':len(rows),'warmup_n':len([r for r in raw['results'] if r['variant']==variant and r['phase']=='warmup']),'durableMs':None,'timingsMs':{},'receivedBytes':{},'storageBytes':{},'incremental':{},'all_reopen_verified':bool(rows) and all(r['verification']['reopened']['sha256']==raw['environment']['fixture']['sha256'] for r in rows)}
 for key in ['observableMs','checkpointAppliedMs','connectionAuthenticationEmptyCheckpointMs']:
  x['timingsMs'][key]=summary([r[key] for r in rows])
 for key in ['tcpReceivedBytes','websocketPayloadBytes','decodedWebsocketPayloadBytes','rsocketPayloadDataBytes','compressedFrames']:
  x['receivedBytes'][key]=summary([r['wire'][key] for r in rows])
 for measure in ['apparent','allocated']:
  x['storageBytes'][measure]={part:summary([r['storage'][part][measure] for r in rows]) for part in ['baseline','total','net']}
 for field in ['title','body']:
  changes=[c for r in rows for c in r['incremental'] if c['field']==field]
  x['incremental'][field]={key:summary([c[key] for c in changes]) for key in ['observableMs','checkpointAppliedMs','sourceCommitMs','sourceDeltaUtf8Bytes']}
  x['incremental'][field]['receivedBytes']={key:summary([c['wire'][key] for c in changes]) for key in ['tcpReceivedBytes','websocketPayloadBytes','decodedWebsocketPayloadBytes','rsocketPayloadDataBytes']}
 res[variant]=x
result={'runId':raw['runId'],'p95_method':'nearest rank; n=10 means p95 equals maximum; not an estimate of population tails','models':res,'failures':raw['failures']}
(run/'summary.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
