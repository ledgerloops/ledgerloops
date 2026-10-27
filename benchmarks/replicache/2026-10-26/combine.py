#!/usr/bin/env python3
"""Combine separately locked model batches without including smoke runs."""
import json,pathlib
p=pathlib.Path(__file__).resolve().parent
parts=[json.loads((p/(m+'-measured-results.json')).read_text()) for m in ['records','shared','collections']]
for model,part in zip(['records','shared','collections'],parts):
    rows=part['results']
    assert len(rows)==13
    assert sum(not r['warmup'] for r in rows)==10
    assert sum(r['warmup'] for r in rows)==3
    assert all(r['model']==model for r in rows)
    for r in rows:
        assert len(r['stages'])==3
        for s in r['stages']:
            assert s['durable_ms'] is None
            assert s['correctness']['full_content_equal'] and s['reopened']['full_content_equal']
            assert s['correctness']['sha256']==s['reopened']['sha256']
            assert s['received_protocol_bytes']==s['cdp_response_body_bytes']
            assert len(s['wire'])==1
combined={'issue':'https://github.com/ledgerloops/ledgerloops/issues/43',
          'environment':parts[0]['environment'],'environments':[x['environment'] for x in parts],
          'results':[r for part in parts for r in part['results']],
          'server_log':[r for part in parts for r in part['server_log']]}
(p/'measured-results.json').write_text(json.dumps(combined,indent=2)+'\n')
print('Verified 39 receivers, 117 phases, 117 full post-reopen comparisons; all CDP body byte counts agree.')
