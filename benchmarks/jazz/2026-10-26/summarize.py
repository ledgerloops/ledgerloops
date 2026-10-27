#!/usr/bin/env python3
"""Validate raw measurements and produce JSON plus a concise plain-text report."""
import json, math, statistics, sys, hashlib
from pathlib import Path
from generate_fixture import generate, encoded

EXPECTED = '9b8f0b8e52345b95d0bd3434d125ef2dc1a688ad537c0c3a1ccc8348981a101a'

def stats(values):
    values = sorted(x for x in values if x is not None)
    if not values:
        return None
    return dict(n=len(values), p50=statistics.median(values),
                p95_nearest_rank=values[math.ceil(.95 * len(values)) - 1], maximum=max(values), minimum=min(values))

def main():
    directory = Path(sys.argv[1])
    raw = json.loads((directory / 'results.json').read_text())
    summaries=[]
    for variant in raw['variants']:
        if variant.get('status') == 'blocked':
            summaries.append({k:variant[k] for k in ['runtime','model','status','error']})
            continue
        transfers=variant['transfers']
        measured=[r for r in transfers if not r['warmup']]
        for row in measured:
            assert row['reopen']['verified_hash']==EXPECTED
            assert row['reopen']['offline_proxy_blocked'] is True
            assert row['reopen']['bytes']==415448
            assert row['observable_ms']>=0
            assert row['durable_ms'] is None or row['durable_ms']>=row['observable_ms']
            for kind in ['apparent','allocated']:
                storage=row['receiver_storage']
                assert storage['net'][kind]==storage['total'][kind]-storage['baseline'][kind]
        increments=[i for r in measured for i in r.get('incrementals',[])]
        for row in measured:
            expected=generate()
            for change in row.get('incrementals',[]):
                collection,field,rep=change['collection'],change['field'],change['repetition']
                original=generate()[collection][0][field]
                expected[collection][0][field]=original+f' [benchmark-{field}-{rep}]'
                assert hashlib.sha256(encoded(expected)).hexdigest()==change['verified_hash']
            if row.get('incrementals') and not row.get('incremental_error'):
                assert row['incrementals_final_reopen']['verified_hash']==row['incrementals'][-1]['verified_hash']
                assert row['incrementals_final_reopen']['offline_proxy_blocked'] is True
        summary={'runtime':variant['runtime'],'model':variant['model'],'status':'measured',
          'warmups':sum(r['warmup'] for r in transfers),'n':len(measured),'row_counts':variant['row_counts'],
          'observable_ms':stats([r['observable_ms'] for r in measured]),'durable_upper_bound_ms':stats([r['durable_ms'] for r in measured]),
          'browser_graceful_close_upper_bound_ms':stats([r.get('graceful_close_upper_bound_ms') for r in measured]),
          'received_ws_payload_bytes':stats([r['wire']['received_ws_payload_bytes'] for r in measured]),
          'received_tcp_stream_bytes':stats([r['wire']['received_tcp_stream_bytes'] for r in measured]),
          'received_engine_decoded_channel_bytes':stats([r['wire'].get('received_engine_decoded_channel_bytes') for r in measured]),
          'received_engine_compressed_channel_bytes':stats([r['wire'].get('received_engine_compressed_channel_bytes') for r in measured]),
          'engine_frame_parse_errors':sum(r['wire'].get('engine_frame_parse_errors',0) for r in measured),
          'engine_codecs':[r['wire'].get('engine_codecs',{}) for r in measured],
          'compressed_ws_frames':sum(r['wire']['compressed_ws_frames'] for r in measured),
          'receiver_storage':{phase:{kind:stats([r['receiver_storage'][phase][kind] for r in measured]) for kind in ['apparent','allocated']} for phase in ['baseline','total','net']},
          'sender_storage':{k:variant['sender_storage'][k] for k in ['apparent','allocated']},
          'required_service_storage':{k:variant['required_service_storage'][k] for k in ['apparent','allocated']},
          'all_reopened_correct':True,'incremental_errors':[r['incremental_error'] for r in measured if 'incremental_error' in r],
          'edited_fixture_reopen_verified':bool(increments) and all(r.get('incrementals_final_reopen',{}).get('offline_proxy_blocked') is True for r in measured if r.get('incrementals')),
          'incrementals':{field:{'n':sum(i['field']==field for i in increments),
            'observable_ms':stats([i['observable_ms'] for i in increments if i['field']==field]),
            'received_ws_payload_bytes':stats([i['wire']['received_ws_payload_bytes'] for i in increments if i['field']==field]),
            'first_received_ws_payload_bytes':next((i['wire']['received_ws_payload_bytes'] for i in increments if i['field']==field),None),
            'first_observable_ms':next((i['observable_ms'] for i in increments if i['field']==field),None),
            'replacement_api_patch_bytes':stats([i['replacement_api_patch_bytes'] for i in increments if i['field']==field])} for field in ['title','body']}}
        summaries.append(summary)
    output={'issue':'https://github.com/ledgerloops/ledgerloops/issues/45','fixture_sha256':EXPECTED,
            'quantiles':'p50=median; p95=nearest rank ceil(.95*n), n=10 implies sample maximum',
            'variants':summaries,'environment':raw['environment']}
    (directory/'summary.json').write_text(json.dumps(output,indent=2)+'\n')
    lines=['Jazz synthetic sync benchmark',output['issue'],'',
      'Pinned relational Jazz 2.0.0-alpha.59, native RocksDB and browser IndexedDB, loopback.',
      'Fixture: 132 records, 415448 bytes; complete hash verified after every measured offline reopen.',
      'Timings exclude sender preparation and receiver startup/auth. Three warmups + ten samples.',
      'p95 is nearest-rank; for ten samples it equals the maximum. No cross-engine ranking.', '',
      'Variant                 observable p50/p95/max ms   native close durability p50 ms    receive WS bytes p50']
    for s in summaries:
        label=f"{s['runtime']}/{s['model']}"
        if s['status']=='blocked':
            lines.append(label+' BLOCKED: '+s['error']['message']);continue
        o=s['observable_ms'];d=s['durable_upper_bound_ms'];wire=s['received_ws_payload_bytes']
        lines.append(f"{label:25s} {o['p50']:.2f}/{o['p95_nearest_rank']:.2f}/{o['maximum']:.2f} ms     "+(f"{d['p50']:.2f}" if d else 'unmeasured')+f"                    {wire['p50']:.0f}")
        storage=s['receiver_storage']
        lines.append('  Receiver apparent baseline/total/net bytes: '+ '/'.join(str(round(storage[phase]['apparent']['p50'])) for phase in ['baseline','total','net']))
        lines.append('  Receiver allocated baseline/total/net bytes: '+ '/'.join(str(round(storage[phase]['allocated']['p50'])) for phase in ['baseline','total','net']))
        lines.append('  Sender apparent/allocated: '+str(s['sender_storage'])+'; Core: '+str(s['required_service_storage']))
        lines.append(f"  Reopened correct: yes, n={s['n']}; warmups={s['warmups']}.")
        if s['browser_graceful_close_upper_bound_ms']:
            close=s['browser_graceful_close_upper_bound_ms']
            lines.append(f"  Browser graceful-close p50/p95/max: {close['p50']:.2f}/{close['p95_nearest_rank']:.2f}/{close['maximum']:.2f} ms; weak persistence boundary.")
        decoded=s['received_engine_decoded_channel_bytes']
        if decoded: lines.append(f"  Decoded engine channel payload p50: {decoded['p50']:.0f} bytes; frame parse errors {s['engine_frame_parse_errors']}.")
        for error in s['incremental_errors']: lines.append('  Incremental blocker: '+error['message'])
        for field,inc in s['incrementals'].items():
            if inc['n']:
                lines.append(f"  Incremental {field}: n={inc['n']}, p50 {inc['observable_ms']['p50']:.2f} ms, receive {inc['received_ws_payload_bytes']['p50']:.0f} bytes.")
                lines.append(f"    First suffix append: {inc['first_observable_ms']:.2f} ms, {inc['first_received_ws_payload_bytes']} receive bytes; later edits change one suffix digit.")
    lines+=['','Native durable timings are conservative upper bounds through session.close, including teardown.',
      'Browser IndexedDB uses relaxed durability: durable_ms is null; close/reopen confirms persisted content only.',
      'Incremental times measure observable convergence; no independent incoming-write durable receipt.',
      'Wire counts include engine metadata and WS payload; stream-byte counts include WS headers, exclude TCP/IP.',
      'Current docs and main source describe SQLite, but the pinned binary actually creates RocksDB stores.',
      'Native build provenance records a dirty-diff hash; exact unpublished diff is unavailable. Package lock pins the actual binary.',
      'Exploratory collection JSON reset failed to restore the original note body within 120s; final tests use successive unique values. See README.txt.',
      'Shared laptop, serialized heavy work, uncontrolled background activity/cache/thermal state.',
      'See README.txt for models, boundaries, commands and limitations; results.json for raw samples and file inventories.']
    (directory/'report.txt').write_text('\n'.join(lines)+'\n')
    print('\n'.join(lines))

if __name__=='__main__':
    main()
