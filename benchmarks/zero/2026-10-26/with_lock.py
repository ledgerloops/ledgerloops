#!/usr/bin/env python3
"""Serialize sustained work; never remove another task's lock. Bounded waiting."""
import os,sys,json,time,subprocess,signal
from pathlib import Path
shared=Path.home()/'Documents/Codex/2026-10-24/th/work/sync-engine-comparison'
lock=shared/'measurement.lock'
owner={'task':'zero-issue-44','pid':os.getpid(),'cwd':os.getcwd(),'utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'command':sys.argv[1:]}
waiter=shared/f'zero-waiting-{os.getpid()}.json'
waiter.write_text(json.dumps(owner,indent=2))
start=time.monotonic(); acquired=False
try:
 while time.monotonic()-start < float(os.environ.get('LOCK_WAIT_SECONDS','900')):
  atomic_waiting=[p for p in shared.iterdir() if 'atomic' in p.name.lower() and any(s in p.name.lower() for s in ('wait','request','priority'))]
  if not atomic_waiting:
   try:
    lock.mkdir();acquired=True;owner['acquired_utc']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime());owner['wait_seconds']=time.monotonic()-start;(lock/'owner.json').write_text(json.dumps(owner,indent=2));break
   except FileExistsError: pass
  time.sleep(0.25)
 if not acquired:
  evidence=[]
  if lock.exists():
   for p in lock.iterdir():
    if p.is_file(): evidence.append({'path':str(p),'text':p.read_text()[:4000]})
  print(json.dumps({'blocked':'shared measurement lock','evidence':evidence}),flush=True);sys.exit(75)
 waiter.unlink(missing_ok=True)
 audit=Path(__file__).resolve().parent/'results'/'lock-events.jsonl';audit.parent.mkdir(exist_ok=True)
 with audit.open('a') as f:f.write(json.dumps({'lock_acquired':owner})+'\n')
 print(json.dumps({'lock_acquired':owner}),flush=True)
 child=subprocess.Popen(sys.argv[1:])
 def stop(sig,frame):
  child.send_signal(sig)
 signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
 sys.exit(child.wait())
finally:
 waiter.unlink(missing_ok=True)
 if acquired and (lock/'owner.json').exists():
  current=json.loads((lock/'owner.json').read_text())
  if current['pid']==os.getpid() and current['task']==owner['task']:
   (lock/'owner.json').unlink();lock.rmdir()
