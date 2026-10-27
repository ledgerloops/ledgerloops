#!/usr/bin/env python3
"""Run task-local heavy work under the shared atomic mkdir lock. Never steals it."""
import os, sys, json, time, uuid, pathlib, subprocess, signal, datetime
LOCK=pathlib.Path.home() / 'Documents/Codex/2026-10-24/th/work/sync-engine-comparison/measurement.lock'
token=str(uuid.uuid4()); pid=os.getpid(); waiting=LOCK.parent/f'jazz-waiting-{pid}.json'
meta={'engine':'jazz','task':'sync-benchmark-jazz','pid':pid,'token':token,'cwd':os.getcwd(),'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'command':sys.argv[1:]}
waiting.write_text(json.dumps(meta,indent=2)+'\n'); start=time.monotonic(); owned=False; child=None
try:
 while not owned:
  priority=list(LOCK.parent.glob('*atomic*waiting*'))+list(LOCK.parent.glob('*atomic*priority*'))
  if priority:
   time.sleep(2)
  else:
   try:
    LOCK.mkdir(); owned=True
   except FileExistsError:
    time.sleep(.2)
  if time.monotonic()-start>1800:
   evidence={p.name:p.read_text() for p in LOCK.glob('*') if p.is_file()}
   evidence.update({p.name:p.read_text() for p in priority if p.is_file()})
   print('LOCK_WAIT_TIMEOUT',json.dumps(evidence),flush=True);sys.exit(75)
 (LOCK/'owner.json').write_text(json.dumps(meta,indent=2)+'\n');waiting.unlink(missing_ok=True)
 print('LOCK_ACQUIRED',json.dumps(meta),flush=True)
 def terminate(sig,frame):
  if child is not None: child.send_signal(sig)
  raise SystemExit(128+sig)
 signal.signal(signal.SIGTERM,terminate); signal.signal(signal.SIGINT,terminate)
 child=subprocess.Popen(sys.argv[1:]); result=child.wait();sys.exit(result)
finally:
 waiting.unlink(missing_ok=True)
 if owned:
  owner=LOCK/'owner.json'
  if owner.exists() and json.loads(owner.read_text()).get('token')==token:
   owner.unlink();LOCK.rmdir();print('LOCK_RELEASED',token,flush=True)
