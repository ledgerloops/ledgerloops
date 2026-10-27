#!/usr/bin/env python3
"""Recompute the key aggregate statistics and exact framing-derived wire split."""
import json, math, pathlib, statistics, sys
p=pathlib.Path(sys.argv[1])
data=json.loads((p/'results.json').read_text())
config=json.loads((p/'model-h-config.json').read_text())
runs=[r for r in data['runs'] if not r['warmup']]
def stats(values):
    values=sorted(values)
    return dict(n=len(values),minimum=min(values),p50=statistics.median(values),p95NearestRank=values[math.ceil(.95*len(values))-1],maximum=max(values))
subjects=list(data['sourceSummary']['envelopes'])
envelopes=data['sourceSummary']['envelopes']
assert all(len(v)==1 for v in envelopes.values())
drive=config['drive']
diff=3+len(drive.encode())+len(json.dumps(dict(pull=[],pullFrom={},push=subjects,remove=[]),sort_keys=True,separators=(',',':')).encode())
headers=runs[0]['chunks']*(1+2+len(drive.encode())+1+2+2)
entry_meta=sum(2+len(s.encode())+4 for s in subjects)
envelope_meta=sum(len(v)*(2+len(s.encode())+4) for s,v in envelopes.items())
stored=json.loads((p/'receiver-initial-logical-storage.json').read_text())
envelope_bytes=stored['Envelopes']['valueBytes']
metadata=diff+headers+entry_meta+envelope_meta
summary=dict(requestToDurableMs=stats([r['syncRequestToDurableMs'] for r in runs]),
    readableConfirmedMs=stats([r['readableConfirmedMs'] for r in runs]),
    connectionAuthMsExcluded=stats([r['connectionAuthMs'] for r in runs]),
    wireBytes=runs[0]['wireBytes'],signedEnvelopeJsonBytes=envelope_bytes,
    protocolMetadataBytes=metadata,crdtSnapshotBytes=runs[0]['wireBytes']-envelope_bytes-metadata,
    disk={k:{b:stats([r[k][b] for r in runs]) for b in ['apparentBytes','allocatedBytes']} for k in ['receiverBaselineDisk','receiverTotalDisk','receiverNetDisk']},
    sourceDisk=data['sourceDisk'],incremental=json.loads((p/'incremental.json').read_text()))
print(json.dumps(summary,indent=2))
