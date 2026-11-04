"""Explicit, Git-independent source release. Never walks operational directories."""
from pathlib import Path
import zipfile,hashlib,json,re,os
ROOT=Path(__file__).resolve().parents[1]
def collect(root=ROOT):
 spec=json.loads((root/'scripts/release-files.json').read_text(encoding='utf-8-sig'))
 files=set()
 def add(relative):
  p=root/relative
  if p.is_symlink() or not p.is_file():raise RuntimeError('Missing/unsafe release file: '+str(relative))
  if not p.resolve().is_relative_to(root.resolve()):raise RuntimeError('File outside release root')
  files.add(p.relative_to(root))
 for name in spec['files']:add(name)
 for tree in spec['trees']:
  base=root/tree
  if not base.is_dir() or base.is_symlink():raise RuntimeError('Missing/unsafe release directory: '+tree)
  for folder,dirs,names in os.walk(base,followlinks=False):
   dirs[:]=[d for d in dirs if d not in {'node_modules','.next','dist','.open-next','.wrangler','__pycache__'} and not (Path(folder)/d).is_symlink()]
   for name in names:
    p=Path(folder)/name
    if p.is_symlink():raise RuntimeError('Symlink in release directory')
    if name.endswith(('.tsbuildinfo','.log','.dump','.sqlite','.sqlite3','.db','.pyc')) or name.startswith(('.env','.dev.vars')):continue
    add(p.relative_to(root))
 for workspace in ['apps/customer','apps/management','services/api']:
  for name in spec['workspaceFiles']:
   if (root/workspace/name).is_file():add(Path(workspace)/name)
 for name in spec['apiScripts']:add(Path('services/api/scripts')/name)
 secret=re.compile(rb'(?:xkeysib|xsmtpsib)-[A-Za-z0-9_-]{35,}|sb_secret_[A-Za-z0-9_-]{25,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')
 for relative in files:
  p=root/relative
  if p.suffix.lower() not in {'.png','.jpg','.jpeg','.webp','.pdf','.woff','.woff2','.ttf','.mp4'} and secret.search(p.read_bytes()):raise RuntimeError('Possible secret; release aborted: '+str(relative))
 return sorted(files)
def build(root=ROOT):
 files=collect(root);version=json.loads((root/'package.json').read_text())['version']
 if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?',version):raise RuntimeError('Invalid version')
 out=root/'release'/'marketplace';out.mkdir(parents=True,exist_ok=True)
 manifest={'version':version,'files':{p.as_posix():hashlib.sha256((root/p).read_bytes()).hexdigest() for p in files},'excluded':'operational data, secrets, legacy runtime, caches, dependencies, external universal starter'}
 archive=out/f'Food_Truck_Live-{version}.zip'
 with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
  for p in files:z.write(root/p,'foodtruck/'+p.as_posix())
  z.writestr('foodtruck/RELEASE-MANIFEST.json',json.dumps(manifest,ensure_ascii=False,indent=2))
 checksum=hashlib.sha256(archive.read_bytes()).hexdigest()
 starter=(root/'scripts/marketplace-start.mjs').read_text(encoding='utf-8')
 starter=starter.replace('__FOODTRUCK_ARCHIVE__',archive.name).replace('__FOODTRUCK_SHA256__',checksum).replace('__FOODTRUCK_VERSION__',version)
 (out/'INICIAR.mjs').write_text(starter,encoding='utf-8',newline='\n')
 print(f'Release: {archive.name} | {len(files)} files | {archive.stat().st_size/1048576:.1f} MiB')
 print('SHA256: '+checksum)
 return archive
if __name__=='__main__':build()
