"""Run after all native package writers and their validations have finished."""
import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
config = json.loads((ROOT / 'desktop/installer-config.json').read_text(encoding='utf-8'))
out = ROOT / 'release/installers'
artifacts = []
for target in config['targets']:
    name = target['id']
    if target['os'] == 'win32':
        suffix = name + '-Setup.exe'
    elif target['os'] == 'darwin':
        suffix = name + '.pkg'
    else:
        suffix = 'linux-' + ('amd64' if target['arch'] == 'x64' else 'arm64') + '.deb'
    path = out / f"Food_Truck_Live-{config['version']}-{suffix}"
    assert path.stat().st_size > 1_000_000, path
    with path.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    artifacts.append({'file': path.name, 'target': name, 'bytes': path.stat().st_size,
                      'sha256': digest, 'signed': False,
                      'validation': 'native-tested' if target['os'] == 'win32' else 'structure-only; native test pending'})
(out / 'SHA256SUMS.txt').write_text(''.join(f"{a['sha256']}  {a['file']}\n" for a in artifacts), encoding='utf-8')
(out / 'RELEASE-MANIFEST.json').write_text(json.dumps({'version': config['version'], 'artifacts': artifacts}, indent=2) + '\n', encoding='utf-8')
for source, destination in [('INSTALADORES_PT.md', 'LEIA-ME.md'), ('VALIDACAO_INSTALADORES.md', 'VALIDACAO.md')]:
    shutil.copyfile(ROOT / 'docs/distribution' / source, out / destination)
print('Final release:', len(artifacts), 'installers; SHA-256, manifest and guides written.')
