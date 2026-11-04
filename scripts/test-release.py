"""Verify allowlist, archive bytes, demo resources and secret rejection."""
import importlib.util,zipfile,json,hashlib,tempfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('release',Path(__file__).with_name('package-release.py'))
release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
archive=release.build()
with zipfile.ZipFile(archive) as z:
 manifest=json.loads(z.read('foodtruck/RELEASE-MANIFEST.json'))
 assert not any(name.endswith(('INICIAR.cmd','INICIAR.mjs')) for name in z.namelist())
 assert set(p.name for p in archive.parent.iterdir())=={archive.name,'INICIAR.mjs'}
 assert hashlib.sha256(archive.read_bytes()).hexdigest() in (archive.parent/'INICIAR.mjs').read_text(encoding='utf-8')
 assert len(z.namelist())==len(manifest['files'])+1
 for name,digest in manifest['files'].items():
  assert hashlib.sha256(z.read('foodtruck/'+name)).hexdigest()==digest,name
  assert not any(p in {'node_modules','.next','data','tmp','release','.git'} for p in Path(name).parts),name
 for name in ['scripts/marketplace-start.mjs','deployment/demo/fixture.json','services/api/migrations/016_installation.sql','apps/management/app/setup/page.tsx']:
  assert name in manifest['files'],name
 for i in range(30):assert f'apps/customer/public/images/products/{i}.webp' in manifest['files']
 assert not any(name.startswith(('app/','lib/','tests/')) for name in manifest['files'])
 with tempfile.TemporaryDirectory() as temp:
  z.extractall(temp);root=Path(temp)/'foodtruck'
  assert set(release.collect(root))=={Path(p) for p in manifest['files']}
  (root/'README.md').write_text('xkeysib-'+'a'*50)
  try:release.collect(root);raise AssertionError('Secret accepted')
  except RuntimeError as e:assert 'secret' in str(e).lower()
print('PASS: archive, hashes, allowlist, demo assets, Git-independent repack and secret rejection.')
