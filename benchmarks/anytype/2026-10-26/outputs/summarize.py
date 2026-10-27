#!/usr/bin/env python3
"""Produce statistics only from complete verified native measurement records."""
import collections, json, math, pathlib, statistics, sys

def distribution(values):
    values=sorted(values)
    return {'n':len(values),'p50':statistics.median(values),'p95_nearest_rank':values[math.ceil(.95*len(values))-1],'max':max(values),'min':min(values)}

def main():
    source=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'outputs/results.jsonl')
    rows=[json.loads(line) for line in source.read_text().splitlines() if line]
    by=collections.defaultdict(list)
    for r in rows:
        if not r['warmup']: by[r['model']].append(r)
    expected='9b8f0b8e52345b95d0bd3434d125ef2dc1a688ad537c0c3a1ccc8348981a101a'
    out={'scope':'native any-sync LocalOnly object-tree protocol experiment; not Anytype application or official service-stack benchmark','raw_source':source.name,'models':{}}
    for model,group in by.items():
        warmups=sum(r['warmup'] for r in rows if r['model']==model)
        assert len(group)==10 and warmups==3,(model,len(group),warmups)
        assert all(r['initial_reopen_sha256']==expected for r in group)
        assert all(len(r['updates'])==2 and r['updated_reopen_sha256']==r['updates'][-1]['sha256'] for r in group)
        s={'measured_runs':len(group),'warmup_runs':warmups,'trees':group[0]['trees'],'initial_reopens_verified':len(group),'updated_reopens_verified':len(group),'updates':{}}
        for key in ['observable_ms','fsync_completion_ms','received_protobuf_bytes','received_transport_bytes','sender_prepare_ms','receiver_prepare_ms','connection_auth_and_network_setup_ms']:
            s[key]=distribution([r[key] for r in group])
        for key in ['receiver_baseline','receiver_total','receiver_net','sender_initial_total','sender_total','receiver_after_updates']:
            s[key]={k:distribution([r[key][k] for r in group]) for k in ['apparent_bytes','allocated_bytes','files']}
        for i,field in enumerate(['issues.0.title','notes.0.body']):
            s['updates'][field]={k:distribution([r['updates'][i][k] for r in group]) for k in ['observable_ms','fsync_completion_ms','received_protobuf_bytes','received_transport_bytes','operation_bytes','source_old_value_bytes','source_new_value_bytes']}
        out['models'][model]=s
    assert set(by)=={'record_trees','collection_blocks','opaque_collections'}
    source.with_name('summary.json').write_text(json.dumps(out,indent=2)+'\n')
    print(json.dumps(out,indent=2))

if __name__=='__main__':main()
