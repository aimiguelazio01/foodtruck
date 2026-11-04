"""Inspect native containers, binary architectures, permissions and complete runtime contents."""
from pathlib import Path
import struct,zlib,xml.etree.ElementTree as ET,gzip,io,tarfile,json,hashlib,subprocess
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'release/installers'
VERSION=json.loads((ROOT/'desktop/installer-config.json').read_text())['version']

def release_files(prefix):
 return {
  prefix+'desktop-dist/services/api/migrations/017_storefront_appearance.sql':'appearance migration',
  prefix+'desktop-dist/services/api/migrations/018_catalog_background.sql':'catalog migration',
  prefix+'apps/customer/public/images/trucks.webp':'truck photographs',
  prefix+'desktop-dist/services/api/src/company.js':'catalog personalization API',
 }
def cpu(data,kind,arch):
 if kind=='windows':assert data[:2]==b'MZ';return
 if kind=='macos':
  expected=0x100000c if arch=='arm64' else 0x1000007
  if data[:4] in [b'\xca\xfe\xba\xbe',b'\xca\xfe\xba\xbf']:
   count=struct.unpack('>I',data[4:8])[0];stride=32 if data[3]==0xbf else 20
   assert expected in [struct.unpack('>I',data[8+i*stride:12+i*stride])[0] for i in range(count)]
   return
  assert data[:4] in [b'\xcf\xfa\xed\xfe',b'\xfe\xed\xfa\xcf'],data[:4]
  endian='<' if data[0]==0xcf else '>';assert struct.unpack(endian+'I',data[4:8])[0]==(0x100000c if arch=='arm64' else 0x1000007)
 else:assert data[:4]==b'\x7fELF';assert struct.unpack('<H',data[18:20])[0]==(183 if arch=='arm64' else 62)
def validate_pkg(file,arch):
 with file.open('rb') as stream:
  magic,size,version,compressed,uncompressed,algorithm=struct.unpack('>IHHQQI',stream.read(28));assert magic==0x78617221 and version==1
  toc=zlib.decompress(stream.read(compressed));assert len(toc)==uncompressed;xml=ET.fromstring(toc);heap=size+compressed
  streams={}
  for entry in xml.findall('./toc/file'):
   name=entry.findtext('name');offset=int(entry.findtext('data/offset'));length=int(entry.findtext('data/length'));stream.seek(heap+offset);streams[name]=stream.read(length)
 assert streams['Bom'].startswith(b'BOMStore');info=ET.fromstring(streams['PackageInfo']);assert info.attrib['install-location']=='/Applications'
 wanted={
  './Food Truck Live.app/Contents/MacOS/Food Truck Live':'launcher',
  './Food Truck Live.app/Contents/Resources/payload/runtime/node':'node',
  './Food Truck Live.app/Contents/Resources/payload/node_modules/@embedded-postgres/darwin-'+arch+'/native/bin/postgres':'postgres',
  './Food Truck Live.app/Contents/Resources/payload/desktop/runtime.mjs':'runtime',
  './Food Truck Live.app/Contents/Resources/payload/desktop-dist/deployment/demo/fixture.json':'demo'
 };wanted.update(release_files('./Food Truck Live.app/Contents/Resources/payload/'));found=set();entries=0;payload=gzip.GzipFile(fileobj=io.BytesIO(streams['Payload']))
 while True:
  head=payload.read(76);assert len(head)==76 and head[:6]==b'070707'
  mode=int(head[18:24],8);nameLength=int(head[59:65],8);length=int(head[65:76],8);name=payload.read(nameLength)[:-1].decode('utf-8');assert '\\' not in name,name
  data=payload.read(length);entries+=1
  if name=='TRAILER!!!':break
  assert '..' not in name.split('/'),name
  if name in wanted:
   found.add(wanted[name]);
   if wanted[name] in ['launcher','node','postgres']:assert mode&0o111;cpu(data[:128],'macos',arch)
 assert found==set(wanted.values()),found
 print('PASS:',file.name,'XAR, BOM,',entries,'CPIO entries, complete app, executable modes and matching Mach-O architecture.')
def members_ar(file):
 result={}
 with file.open('rb') as stream:
  assert stream.read(8)==b'!<arch>\n'
  while head:=stream.read(60):
   assert len(head)==60 and head[-2:]==b'`\n';name=head[:16].decode().strip().rstrip('/');size=int(head[48:58]);result[name]=stream.read(size)
   if size%2:stream.read(1)
 return result
def validate_deb(file,arch):
 members=members_ar(file);assert members['debian-binary']==b'2.0\n'
 with tarfile.open(fileobj=io.BytesIO(members['control.tar.gz']),mode='r:gz') as tar:control=tar.extractfile('./control').read().decode();assert 'Architecture: '+('arm64' if arch=='arm64' else 'amd64') in control
 wanted={'opt/food-truck-live/FoodTruckLive':'launcher','opt/food-truck-live/payload/runtime/node':'node','opt/food-truck-live/payload/node_modules/@embedded-postgres/linux-'+arch+'/native/bin/postgres':'postgres','usr/share/applications/food-truck-live.desktop':'desktop','opt/food-truck-live/payload/desktop-dist/deployment/demo/fixture.json':'demo'};found=set()
 wanted.update(release_files('opt/food-truck-live/payload/'))
 with tarfile.open(fileobj=io.BytesIO(members['data.tar.gz']),mode='r:gz') as tar:
  for member in tar:
   assert not member.name.startswith('/') and '..' not in member.name.split('/'),member.name
   if member.name in wanted:
    found.add(wanted[member.name]);data=tar.extractfile(member).read(128)
    if wanted[member.name] in ['launcher','node','postgres']:assert member.mode&0o111;cpu(data,'linux',arch)
 assert found==set(wanted.values()),found
 print('PASS:',file.name,'Debian container, desktop shortcut, complete runtime and matching ELF architecture.')
def validate_windows(file):
 data=file.read_bytes();cpu(data[:128],'windows','x64')
 assert b'\xef\xbe\xad\xdeNullsoftInst' in data,'Missing native NSIS header'
 stage=ROOT/'output/installers/stage/windows-x64'
 for name in release_files('payload/'):
  assert (stage/name).is_file(),name
 for name in ['FoodTruckLive.exe','payload/runtime/node.exe','payload/desktop/runtime.mjs']:
  assert (stage/name).is_file(),name
 script=(ROOT/'output/installers/windows.nsi').read_text(encoding='utf-8-sig')
 assert 'WriteUninstaller' in script and 'CreateShortCut' in script
 print('PASS:',file.name,'native NSIS header, offline payload source, shortcuts and uninstaller; Setup execution is covered separately.')
if __name__=='__main__':
 expected=[(f'Food_Truck_Live-{VERSION}-windows-x64-Setup.exe','windows','x64'),(f'Food_Truck_Live-{VERSION}-macos-arm64.pkg','macos','arm64'),(f'Food_Truck_Live-{VERSION}-macos-x64.pkg','macos','x64'),(f'Food_Truck_Live-{VERSION}-linux-amd64.deb','linux','x64'),(f'Food_Truck_Live-{VERSION}-linux-arm64.deb','linux','arm64')]
 for name,kind,arch in expected:
  file=OUT/name;assert file.is_file() and file.stat().st_size>1_000_000,name
  if kind=='windows':validate_windows(file)
  elif kind=='macos':validate_pkg(file,arch)
  else:validate_deb(file,arch)
