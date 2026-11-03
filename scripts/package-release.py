"""Build a redistributable source ZIP without operational data or secrets."""
from pathlib import Path
import subprocess,zipfile,hashlib,json,re,sys
root=Path(__file__).resolve().parents[1]
raw=subprocess.check_output(['git','-c','safe.directory='+root.as_posix(),'ls-files','--cached','--others','--exclude-standard','-z'],cwd=root)
paths=sorted(set(p for p in raw.decode('utf-8').split('\0') if p))
excluded={'.git','.vercel','.codex','.agents','node_modules','.next','.open-next','.wrangler','data','tmp','output','release','test-results','playwright-report','.npm-cache'}
files=[]
secret=re.compile(rb'(?:xkeysib|xsmtpsib)-[A-Za-z0-9_-]{35,}|sb_secret_[A-Za-z0-9_-]{25,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')
for relative in paths:
 p=Path(relative)
 if any(part in excluded for part in p.parts):continue
 if p.name.startswith('.env') and not p.name.endswith('.example'):continue
 if p.name.startswith('.dev.vars') and not p.name.endswith('.example'):continue
 if p.suffix.lower() in {'.sqlite','.sqlite3','.db','.dump','.log','.tsbuildinfo'}:continue
 full=root/p
 if not full.is_file() or full.is_symlink():continue
 if full.stat().st_size<5_000_000 and p.suffix.lower() not in {'.png','.jpg','.jpeg','.webp','.pdf','.woff','.woff2','.ttf','.mp4'}:
  if secret.search(full.read_bytes()):raise RuntimeError('Possible secret in '+relative+'; release aborted, value not displayed.')
 files.append(p)
required=['package.json','package-lock.json','.env.install.example','compose.install.yaml','docs/manuals/Manual_Food_Truck_Live_PT.pdf','docs/manuals/Manual_Instalacao_Food_Truck_Live_PT.pdf']
for name in required:
 if Path(name) not in files:raise RuntimeError('Missing release file: '+name)
out=root/'release';out.mkdir(exist_ok=True)
manifest={'edition':'2026-11-03','files':{p.as_posix():hashlib.sha256((root/p).read_bytes()).hexdigest() for p in files},'excluded':'operational data, secrets, caches, dependencies'}
archive=out/'Food_Truck_Live_Instalacao.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for p in files:z.write(root/p,'foodtruck/'+p.as_posix())
 z.writestr('foodtruck/RELEASE-MANIFEST.json',json.dumps(manifest,ensure_ascii=False,indent=2))
checksum=hashlib.sha256(archive.read_bytes()).hexdigest();(out/'SHA256SUMS.txt').write_text(checksum+'  '+archive.name+'\n',encoding='utf-8')
print('Release:',archive.name,'|',len(files),'files |',round(archive.stat().st_size/1048576,1),'MiB')
print('SHA256:',checksum)
