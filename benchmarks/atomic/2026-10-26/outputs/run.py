#!/usr/bin/env python3
"""Build/run in task-owned /private/tmp, invoked through with_measurement_lock.py."""
import datetime, hashlib, json, os, pathlib, shutil, subprocess, sys, tempfile
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT/'outputs'
PIN = '396f0da075bd514e2c46b2fa33a575b35c14b2a6'
fallback = (pathlib.Path.home()/'gh/ontola/worktrees/atomic-server/sync-push-batching')
state = OUT/'runtime.json'
if state.exists():
    runtime=pathlib.Path(json.loads(state.read_text())['runtimeDirectory'])
else:
    runtime=pathlib.Path(tempfile.mkdtemp(prefix='atomic-sync-model-h-',dir='/private/tmp'))
    state.write_text(json.dumps({'runtimeDirectory':str(runtime)},indent=2)+'\n')
engine=runtime/'engine'
if not engine.exists():
    if fallback.exists() and subprocess.check_output(['git','-C',str(fallback),'rev-parse','HEAD'],text=True).strip()==PIN:
        # Copy only published library source, never an existing database or runtime identity.
        engine.mkdir()
        shutil.copytree(fallback/'lib',engine/'lib',ignore=shutil.ignore_patterns('target','.temp','*.redb'))
        (runtime/'source-pin.json').write_text(json.dumps({'commit':PIN,'readOnlySource':str(fallback),'scope':'lib source only'},indent=2)+'\n')
    else:
        subprocess.run(['git','clone','--filter=blob:none','--no-checkout','https://github.com/ontola/atomic-server.git',str(engine)],check=True)
        subprocess.run(['git','-C',str(engine),'checkout',PIN],check=True)
shutil.copytree(OUT/'harness',runtime/'harness',dirs_exist_ok=True,ignore=shutil.ignore_patterns('target'))
manifest=runtime/'harness/Cargo.toml'
manifest.write_text(manifest.read_text().replace('../../work/atomic-server/lib',str(engine/'lib')))
shutil.copyfile(OUT/'fixture/fixture.json',runtime/'fixture.json')
assert hashlib.sha256((runtime/'fixture.json').read_bytes()).hexdigest()=='9b8f0b8e52345b95d0bd3434d125ef2dc1a688ad537c0c3a1ccc8348981a101a'
env=dict(os.environ,CARGO_HOME=str(runtime/'cargo-home'),CARGO_TARGET_DIR=str(runtime/'target'),CARGO_BUILD_BUILD_DIR=str(runtime/'build'))
subprocess.run(['cargo','build','--manifest-path',str(manifest),'--release','--locked','-j','4'],cwd=runtime,env=env,check=True)
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
run_dir=runtime/('run-'+stamp)
log=runtime/('model-h-'+stamp+'.jsonl')
with log.open('w') as raw:
    proc=subprocess.Popen([str(runtime/'target/release/atomic-sync-benchmark'),str(runtime/'fixture.json'),str(run_dir),'13'],cwd=runtime,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
    for line in proc.stdout:
        print(line,end='',flush=True);raw.write(line);raw.flush()
    code=proc.wait()
(OUT/'latest-run.json').write_text(json.dumps({'runDirectory':str(run_dir),'exitCode':code,'utc':stamp,'runtimeDirectory':str(runtime)},indent=2)+'\n')
# Store only synthetic aggregates, mappings and verification evidence in deliverables.
dest=OUT/('model-h-'+stamp)
dest.mkdir()
shutil.copyfile(log,dest/'raw.jsonl')
for p in run_dir.glob('*.json'):
    shutil.copyfile(p,dest/p.name)
shutil.copyfile(runtime/'harness/Cargo.lock',OUT/'harness/Cargo.lock')
print(json.dumps({'artifacts':str(dest),'exitCode':code}))
sys.exit(code)
