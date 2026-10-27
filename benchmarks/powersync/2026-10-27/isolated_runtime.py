#!/usr/bin/env python3
"""Stage code/dependencies outside a file-provider directory, then exec the runner.
Invoke through with_measurement_lock.py. All installation and benchmarks retain
that wrapper's ownership and PID relationship.
"""
import json,os,pathlib,shutil,subprocess,sys,tempfile
source=pathlib.Path(__file__).resolve().parent
runtime=pathlib.Path(tempfile.mkdtemp(prefix='powersync-issue42-runtime-',dir='/private/tmp'))
state=pathlib.Path.cwd()/'work'
state.mkdir(exist_ok=True)
(state/'primary-runtime-location.txt').write_text(str(runtime)+'\n')
for name in ['package.json','package-lock.json','run.mjs','models.mjs','wire.mjs','storage.mjs','verify-wire.mjs','summarize.py','generate_fixture.py','issue-42.md']:
 shutil.copyfile(source/name,runtime/name)
shutil.copytree(source/'fixture',runtime/'fixture')
print('ISOLATED_RUNTIME '+str(runtime),flush=True)
(runtime/'user.npmrc').write_text('')
(runtime/'global.npmrc').write_text('')
subprocess.run(['npm','ci','--prefix',str(runtime),'--cache',str(runtime/'npm-cache'),'--userconfig',str(runtime/'user.npmrc'),'--globalconfig',str(runtime/'global.npmrc'),'--no-audit','--no-fund'],check=True)
subprocess.run(['node',str(runtime/'verify-wire.mjs')],check=True)
os.execvp('node',['node',str(runtime/'run.mjs')])
