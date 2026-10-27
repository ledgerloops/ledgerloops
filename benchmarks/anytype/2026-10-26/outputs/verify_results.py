#!/usr/bin/env python3
"""Independently check all fixture hashes and measurement bookkeeping in Python."""
import hashlib, json, pathlib
from generate_fixture import encoded

OUT=pathlib.Path(__file__).resolve().parent

def main():
    blob=(OUT/'fixture/fixture.json').read_bytes()
    manifest=json.loads((OUT/'fixture/manifest.json').read_text())
    assert len(blob)==415448 and hashlib.sha256(blob).hexdigest()==manifest['sha256']=='9b8f0b8e52345b95d0bd3434d125ef2dc1a688ad537c0c3a1ccc8348981a101a'
    data=json.loads(blob)
    data['issues'][0]['title']='Synthetic issue title updated'
    title=hashlib.sha256(encoded(data)).hexdigest()
    data['notes'][0]['body']='Synthetic note body updated'
    final=hashlib.sha256(encoded(data)).hexdigest()
    rows=[json.loads(x) for x in (OUT/'results.jsonl').read_text().splitlines() if x]
    assert len(rows)==39
    for model in ['record_trees','collection_blocks','opaque_collections']:
        selected=[r for r in rows if r['model']==model]
        assert sorted(r['run'] for r in selected)==list(range(-3,10))
        for r in selected:
            assert r['warmup']==(r['run']<0)
            assert r['trees']==(132 if model=='record_trees' else 2)
            assert r['initial_reopen_sha256']==manifest['sha256']
            assert r['updates'][0]['sha256']==title
            assert r['updates'][1]['sha256']==r['updated_reopen_sha256']==final
            assert len(r['security_checks'])==4
            assert r['fsync_completion_ms']>=r['observable_ms']>0
            assert r['received_transport_bytes']>=r['received_protobuf_bytes']>415448
            assert r['required_service_storage_bytes']==0
            for key in ['apparent_bytes','allocated_bytes','files']:
                assert r['receiver_total'][key]-r['receiver_baseline'][key]==r['receiver_net'][key]
            for u in r['updates']:
                assert u['fsync_completion_ms']>=u['observable_ms']>0
    result={'status':'passed','transfers':39,'measured':30,'warmups':9,'initial_reopens_verified':39,'updated_reopens_verified':39,'initial_sha256':manifest['sha256'],'issue_title_update_sha256':title,'note_body_update_sha256':final,'checks':'Python-generated expected fixture hashes matched every Go initial/update/reopen result; checked run counts, wire sizes, monotonic persistence completion, security assertions and disk arithmetic'}
    (OUT/'verification.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))

if __name__=='__main__': main()
