$ErrorActionPreference = 'Stop'
# Exercise the launcher's actual process block under Windows PowerShell 5.1,
# replacing only the executable/arguments with a local stdin fixture.
$source = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'run-pilot.ps1') -Raw
$begin = $source.IndexOf('    $start = New-Object System.Diagnostics.ProcessStartInfo')
$end = $source.IndexOf('    if ($pilotExit -ne 0)', $begin)
if ($begin -lt 0 -or $end -lt 0) { throw 'Process block not found' }
$block = $source.Substring($begin, $end - $begin)
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('foodtruck-process-test-' + [guid]::NewGuid())
[void](New-Item -ItemType Directory -Path $temporary)
try {
    $fixture = Join-Path $temporary 'stdin.cjs'
    "let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>input+=s);process.stdin.on('end',()=>{const v=JSON.parse(input);process.stdout.write(JSON.stringify({ok:v.name==='Caf\u00e9 \ud83d\ude9a'}));process.stderr.write('diagnostic fixture');});" | Set-Content -LiteralPath $fixture -Encoding ascii
    $launcher = $temporary
    $errorLog = Join-Path $temporary 'stderr.txt'
    $event = @{ name = ('Caf' + [char]0xe9 + ' ' + [char]0xd83d + [char]0xde9a) }
    $block = $block.Replace("`$start.FileName = 'go'", "`$start.FileName = 'node'")
    $block = $block.Replace("`$start.Arguments = 'run -buildvcs=false ./cmd/marketplace-pilot'", "`$start.Arguments = 'stdin.cjs'")
    . ([scriptblock]::Create($block))
    if ($pilotExit -ne 0 -or -not ($result | ConvertFrom-Json).ok) { throw 'UTF-8 stdin failed' }
    if ((Get-Content -LiteralPath $errorLog -Raw).Trim() -ne 'diagnostic fixture') { throw 'stderr capture failed' }
    Write-Host 'PASS: process launch, UTF-8 stdin, stdout, stderr and exit code.'
} finally {
    Remove-Item -LiteralPath $temporary -Recurse -Force
}
