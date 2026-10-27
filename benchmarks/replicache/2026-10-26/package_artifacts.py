#!/usr/bin/env python3
import datetime,hashlib,json,pathlib,zipfile
p=pathlib.Path(__file__).resolve().parent
files=[f for f in p.rglob('*') if f.is_file() and 'node_modules' not in f.parts and '.work' not in f.parts and '__pycache__' not in f.parts and f.suffix!='.pyc' and f.name!='SHA256SUMS']
status={'status':'complete_with_durability_limit','utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'issue':'https://github.com/ledgerloops/ledgerloops/issues/43','fixture_verified':True,
 'measured_runs':30,'warmup_runs':9,'models':3,'full_reopen_verified_phases':117,
 'durable_timing_available':False,'report':'REPORT.md','results':'measured-results.json','summary':'measured-summary.json'}
(p/'status.json').write_text(json.dumps(status,indent=2)+'\n')
sums=[]
for f in sorted(files):
 if f.name!='lock-events.jsonl':sums.append(hashlib.sha256(f.read_bytes()).hexdigest()+'  '+str(f.relative_to(p)))
(p/'SHA256SUMS').write_text('\n'.join(sums)+'\n')
files.append(p/'SHA256SUMS')
dest=p.parent/'replicache-benchmark.zip'
with zipfile.ZipFile(dest,'w',zipfile.ZIP_DEFLATED) as z:
 for f in files:z.write(f,arcname='replicache-benchmark/'+str(f.relative_to(p)))
print('Packaged',len(files),'files to',dest)
