"""Create native installer containers without copying operational data."""
from pathlib import Path
import sys,json,zipfile,tarfile,shutil,subprocess,io,gzip,hashlib,os
ROOT=Path(__file__).resolve().parents[1]
CONFIG=json.loads((ROOT/'desktop/installer-config.json').read_text(encoding='utf-8'))
def target(name):return next(t for t in CONFIG['targets'] if t['id']==name)
def extract_node(name,archive,payload):
 t=target(name);runtime=Path(payload)/'runtime';runtime.mkdir(parents=True,exist_ok=True)
 prefix=f"node-v{CONFIG['nodeVersion']}-{t['node']}/"
 if t['os']=='win32':
  with zipfile.ZipFile(archive) as z:
   (runtime/'node.exe').write_bytes(z.read(prefix+'node.exe'));(runtime/'NODE-LICENSE.txt').write_bytes(z.read(prefix+'LICENSE'))
 else:
  with tarfile.open(archive,'r:gz') as z:
   (runtime/'node').write_bytes(z.extractfile(prefix+'bin/node').read());(runtime/'NODE-LICENSE.txt').write_bytes(z.extractfile(prefix+'LICENSE').read())
  (runtime/'node').chmod(0o755)
def executable(path):
 with path.open('rb') as f:magic=f.read(4)
 return magic in [b'\x7fELF',b'\xcf\xfa\xed\xfe',b'\xfe\xed\xfa\xcf',b'\xca\xfe\xba\xbe']
def linux_deb(t,stage,out):
 arch='amd64' if t['arch']=='x64' else 'arm64';version=CONFIG['version'];name=f'Food_Truck_Live-{version}-linux-{arch}.deb'
 work=ROOT/'output/installers/packages'/t['id'];work.mkdir(parents=True,exist_ok=True)
 files={}
 for p in sorted(stage.rglob('*')):
  if p.is_file() and p.name!='BUILD.json':files['opt/food-truck-live/'+p.relative_to(stage).as_posix()]=p
 desktop='[Desktop Entry]\nType=Application\nName=Food Truck Live\nComment=Demo e gestão local de food trucks\nExec=/opt/food-truck-live/FoodTruckLive\nIcon=food-truck-live\nTerminal=false\nCategories=Office;\nStartupNotify=false\n'
 data=work/'data.tar.gz'
 with data.open('wb') as f,gzip.GzipFile(fileobj=f,mode='wb',mtime=0,compresslevel=6) as gz,tarfile.open(fileobj=gz,mode='w') as tar:
  for namepath,p in files.items():
   info=tarfile.TarInfo(namepath);info.size=p.stat().st_size;info.mode=0o755 if executable(p) else 0o644;info.uid=info.gid=0;info.mtime=0
   with p.open('rb') as source:tar.addfile(info,source)
  for path,content in [('usr/share/applications/food-truck-live.desktop',desktop.encode()),('usr/share/icons/hicolor/512x512/apps/food-truck-live.png',(stage/'icon.png').read_bytes())]:
   info=tarfile.TarInfo(path);info.size=len(content);info.mode=0o644;tar.addfile(info,io.BytesIO(content))
  info=tarfile.TarInfo('usr/bin/foodtruck-live');info.type=tarfile.SYMTYPE;info.linkname='/opt/food-truck-live/FoodTruckLive';info.mode=0o755;tar.addfile(info)
 control=f'Package: food-truck-live\nVersion: {version}\nArchitecture: {arch}\nMaintainer: Food Truck Live\nSection: office\nPriority: optional\nDepends: libc6 (>= 2.28), libstdc++6, libgcc-s1, xdg-utils\nDescription: Gestão local de food trucks\n Inclui aplicação, Node.js e PostgreSQL; não exige comandos de instalação adicionais.\n'
 metadata=work/'control.tar.gz'
 with metadata.open('wb') as f,gzip.GzipFile(fileobj=f,mode='wb',mtime=0) as gz,tarfile.open(fileobj=gz,mode='w') as tar:
  info=tarfile.TarInfo('./control');raw=control.encode();info.size=len(raw);info.mode=0o644;tar.addfile(info,io.BytesIO(raw))
 with (out/name).open('wb') as f:
  f.write(b'!<arch>\n')
  for label,payload in [('debian-binary',b'2.0\n'),('control.tar.gz',metadata),('data.tar.gz',data)]:
   size=len(payload) if isinstance(payload,bytes) else payload.stat().st_size
   f.write(f'{label+"/":<16}{0:<12}{0:<6}{0:<6}{"100644":<8}{size:<10}`\n'.encode())
   if isinstance(payload,bytes):f.write(payload)
   else:
    with payload.open('rb') as source:shutil.copyfileobj(source,f)
   if size%2:f.write(b'\n')
 return out/name
def windows_nsis(stage,out):
 from PIL import Image
 icon=stage/'app.ico';Image.open(stage/'icon.png').save(icon,sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
 compiler=ROOT/'tmp/installer-tools/nsis/Bin/makensis.exe'
 if not compiler.exists():raise RuntimeError('Execute desktop/setup-tools.mjs antes de gerar Windows.')
 artifact=out/f"Food_Truck_Live-{CONFIG['version']}-windows-x64-Setup.exe"
 script=ROOT/'output/installers/windows.nsi'
 contents=r'''Unicode true
!include "MUI2.nsh"
Name "Food Truck Live"
OutFile "__OUT__"
InstallDir "$LOCALAPPDATA\Programs\Food Truck Live"
RequestExecutionLevel user
SetCompressor /SOLID lzma
Icon "__ICON__"
UninstallIcon "__ICON__"
!define MUI_FINISHPAGE_RUN "$INSTDIR\FoodTruckLive.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Abrir Food Truck Live"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Portuguese"
Section "Instalar"
 SetShellVarContext current
 IfFileExists "$INSTDIR\FoodTruckLive.exe" 0 install_files
 ExecWait '"$INSTDIR\FoodTruckLive.exe" --quit' $0
 StrCmp $0 0 +2
 Abort "Feche Food Truck Live antes de atualizar."
 install_files:
 SetOutPath "$INSTDIR"
 File /r "__STAGE__\*"
 WriteUninstaller "$INSTDIR\Desinstalar.exe"
 CreateDirectory "$SMPROGRAMS\Food Truck Live"
 CreateShortCut "$SMPROGRAMS\Food Truck Live\Food Truck Live.lnk" "$INSTDIR\FoodTruckLive.exe" "" "$INSTDIR\app.ico"
 CreateShortCut "$DESKTOP\Food Truck Live.lnk" "$INSTDIR\FoodTruckLive.exe" "" "$INSTDIR\app.ico"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoodTruckLive" "DisplayName" "Food Truck Live"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoodTruckLive" "DisplayVersion" "__VERSION__"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoodTruckLive" "UninstallString" '"$INSTDIR\Desinstalar.exe"'
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoodTruckLive" "DisplayIcon" "$INSTDIR\app.ico"
SectionEnd
Section "Uninstall"
 SetShellVarContext current
 ExecWait '"$INSTDIR\FoodTruckLive.exe" --quit' $0
 StrCmp $0 0 +2
 Abort "Feche Food Truck Live antes de desinstalar."
 Delete "$DESKTOP\Food Truck Live.lnk"
 Delete "$SMPROGRAMS\Food Truck Live\Food Truck Live.lnk"
 RMDir "$SMPROGRAMS\Food Truck Live"
 RMDir /r "$INSTDIR\payload"
 Delete "$INSTDIR\FoodTruckLive.exe"
 Delete "$INSTDIR\app.ico"
 Delete "$INSTDIR\icon.png"
 Delete "$INSTDIR\BUILD.json"
 Delete "$INSTDIR\Desinstalar.exe"
 RMDir "$INSTDIR"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoodTruckLive"
SectionEnd
'''
 for key,value in {'__OUT__':artifact,'__STAGE__':stage,'__ICON__':icon,'__VERSION__':CONFIG['version']}.items():contents=contents.replace(key,str(value))
 script.write_text(contents,encoding='utf-8-sig',newline='\r\n');subprocess.run([str(compiler),str(script)],check=True);return artifact
def mac_pkg(t,stage,out):
 tool=ROOT/'tmp/installer-tools/macpkg.exe';app=ROOT/'output/installers/macos'/t['id']/'Food Truck Live.app';app.parent.mkdir(parents=True,exist_ok=True)
 subprocess.run([str(tool),'app','build','--name','Food Truck Live','--id','com.foodtrucklive.desktop','--version',CONFIG['version'],'--min-os','14.0','--bin',str(stage/'FoodTruckLive'),'--icon',str(stage/'icon.png'),'--out',str(app)],check=True)
 def copy_changed(src,dst):
  source,destination=Path(src),Path(dst)
  if destination.exists() and source.stat().st_size==destination.stat().st_size and source.stat().st_mtime_ns==destination.stat().st_mtime_ns:return dst
  return shutil.copy2(src,dst)
 shutil.copytree(stage/'payload',app/'Contents/Resources/payload',dirs_exist_ok=True,copy_function=copy_changed)
 artifact=out/f"Food_Truck_Live-{CONFIG['version']}-{t['id']}.pkg"
 subprocess.run([str(tool),'pkg','build','--id','com.foodtrucklive.desktop.pkg','--version',CONFIG['version'],'--location','/Applications','--payload',str(app),'--out',str(artifact)],check=True);return artifact
def build(name):
 t=target(name);stage=ROOT/'output/installers/stage'/name;out=ROOT/'release/installers';out.mkdir(parents=True,exist_ok=True)
 artifact=windows_nsis(stage,out) if t['os']=='win32' else linux_deb(t,stage,out) if t['os']=='linux' else mac_pkg(t,stage,out)
 print('Installer:',artifact.name,'|',round(artifact.stat().st_size/1048576,1),'MiB')
 sums=[]
 for p in sorted(out.iterdir()):
  if p.suffix in ['.exe','.pkg','.deb']:sums.append(hashlib.file_digest(p.open('rb'),'sha256').hexdigest()+'  '+p.name)
 (out/'SHA256SUMS.txt').write_text('\n'.join(sums)+'\n',encoding='utf-8')
if __name__=='__main__':
 if sys.argv[1]=='extract-node':extract_node(*sys.argv[2:])
 else:build(sys.argv[1])
