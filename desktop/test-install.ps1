$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'installer-config.json') -Raw | ConvertFrom-Json
$installer = Join-Path $workspace "release/installers/Food_Truck_Live-$($config.version)-windows-x64-Setup.exe"
$registry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\FoodTruckLive'
$desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Food Truck Live.lnk'
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Food Truck Live'
$defaultControl = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'FoodTruckLive/desktop-control.json'
if ((Test-Path $registry) -or (Test-Path -LiteralPath $desktopLink) -or (Test-Path -LiteralPath $menu) -or (Test-Path -LiteralPath $defaultControl)) { throw 'Já existe uma instalação/atalho do utilizador. O teste não altera essa instalação.' }
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$target = [IO.Path]::GetFullPath((Join-Path $workspace "output/installers/setup-test-$stamp"))
$data = [IO.Path]::GetFullPath((Join-Path $workspace "tmp/installed-data-$stamp"))
if (-not $target.StartsWith($workspace + [IO.Path]::DirectorySeparatorChar) -or (Test-Path -LiteralPath $target)) { throw 'Pasta de teste inválida.' }
New-Item -ItemType Directory -Path $data | Out-Null
Set-Content -LiteralPath (Join-Path $data 'preservar.txt') -Value 'Dados privados de teste'
$setup = Start-Process -FilePath $installer -ArgumentList "/S /D=$target" -WindowStyle Hidden -PassThru -Wait
if ($setup.ExitCode -ne 0) { throw "Instalador terminou com $($setup.ExitCode)." }
$program = Join-Path $target 'FoodTruckLive.exe'
if (-not (Test-Path -LiteralPath $program)) { throw 'O instalador não criou o executável na pasta de teste.' }
$expected = '"' + (Join-Path $target 'Desinstalar.exe') + '"'
if ((Get-ItemProperty $registry).UninstallString -ne $expected) { throw 'Comando de desinstalação incorreto.' }
if (-not (Test-Path -LiteralPath $desktopLink)) { throw 'Atalho não criado.' }
$node = Join-Path $target 'payload/runtime/node.exe'
if ((& $node --version).Trim() -ne ('v' + $config.nodeVersion)) { throw 'Node.js incluído inválido.' }
$stdout = Join-Path $data 'control.stdout'
$stderr = Join-Path $data 'control.stderr'
$app = Start-Process -FilePath $program -ArgumentList "--data-dir `"$data`" --no-browser --print-control" -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
try {
    $address = ''
    for ($i=0; $i -lt 100; $i++) {
        if (Test-Path -LiteralPath (Join-Path $data 'desktop-control.json')) { $control = Get-Content -LiteralPath (Join-Path $data 'desktop-control.json') -Raw | ConvertFrom-Json; $address = $control.url + '/#' + $control.token }
        if ($address.StartsWith('http://127.0.0.1:')) { break }
        Start-Sleep -Milliseconds 100
    }
    if (-not $address.StartsWith('http://127.0.0.1:')) { throw 'O programa instalado não abriu o controlo local.' }
    $uri = [Uri]$address
    $token = $uri.Fragment.Substring(1)
    $status = Invoke-RestMethod -Uri ($uri.GetLeftPart([UriPartial]::Authority) + '/status') -Headers @{'X-Desktop-Token'=$token}
    if ($status.state -ne 'idle') { throw 'Estado inicial incorreto.' }
} finally {
    $quit = Start-Process -FilePath $program -ArgumentList "--data-dir `"$data`" --quit" -WindowStyle Hidden -PassThru -Wait
    if ($quit.ExitCode -ne 0) { throw 'O programa instalado não encerrou.' }
    $app.WaitForExit(10000) | Out-Null
}
$uninstaller = Start-Process -FilePath (Join-Path $target 'Desinstalar.exe') -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
for ($i=0; $i -lt 240 -and ((Test-Path -LiteralPath $program) -or (Test-Path $registry)); $i++) { Start-Sleep -Milliseconds 500 }
if ((Test-Path -LiteralPath $program) -or (Test-Path $registry) -or (Test-Path -LiteralPath $desktopLink)) { throw 'A desinstalação não ficou concluída.' }
if (-not (Test-Path -LiteralPath (Join-Path $data 'preservar.txt'))) { throw 'Os dados privados não foram preservados.' }
Write-Output 'PASS: Setup real, atalho, registo de desinstalação, Node incluído, execução instalada, desinstalação e dados preservados.'
