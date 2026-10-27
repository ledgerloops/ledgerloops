#!/usr/bin/env python3
"""Copy only synthetic aggregate results from the isolated runtime and audit them."""
import pathlib,shutil,subprocess,sys
source=pathlib.Path(__file__).resolve().parent
runtime=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else pathlib.Path((pathlib.Path.cwd()/'work/primary-runtime-location.txt').read_text().strip())
runid=(runtime/'results/latest.txt').read_text().strip()
dest=source/'results'/runid
shutil.copytree(runtime/'results'/runid,dest,dirs_exist_ok=True)
(source/'results/latest.txt').write_text(runid+'\n')
subprocess.run([sys.executable,str(source/'verify_results.py'),str(dest)],check=True)
subprocess.run([sys.executable,str(source/'summarize.py'),str(dest)],check=True,stdout=subprocess.DEVNULL)
print('Verified results and summary: '+str(dest))
