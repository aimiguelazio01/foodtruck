param([switch]$PrepareOnly, [switch]$CheckDialog)
$ErrorActionPreference = 'Stop'
Set-PSDebug -Off
$DebugPreference = 'SilentlyContinue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$package = Join-Path $root 'output/cloudflare/1.1.2-preview.4'
$launcher = Join-Path $root 'desktop/launcher'
$account = '7ea0c3dd1594de346fbfb1ac7764e425'
$purchase = 'foodtruck-piloto-001'
$journal = Join-Path $root 'output/distribution/cloudflare-pilot'
$resultLog = Join-Path $root 'output/distribution/cloudflare-pilot-result.txt'
$errorLog = Join-Path $root 'output/distribution/cloudflare-pilot-error.txt'
$temporary = Join-Path $root ('output/distribution/pilot-' + [guid]::NewGuid().ToString('N'))
$previousToken = $env:CLOUDFLARE_API_TOKEN
$previousKey = $env:FOODTRUCK_LICENSE_PUBLIC_KEY

function Invoke-GoCommand([string[]]$Arguments) {
    & go -C $launcher @Arguments
    if ($LASTEXITCODE -ne 0) { throw 'O motor do piloto terminou com erro. Veja a mensagem anterior.' }
}

function New-PilotDialog {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [System.Windows.Forms.Application]::EnableVisualStyles()
    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'Food Truck Live - Publicar piloto'
    $form.ClientSize = New-Object System.Drawing.Size(560, 420)
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.Font = New-Object System.Drawing.Font('Segoe UI', 10)
    $intro = New-Object System.Windows.Forms.Label
    $intro.Text = 'Conta do piloto: aimiguelazio03.workers.dev'
    $intro.SetBounds(20, 18, 520, 28)
    $form.Controls.Add($intro)
    $fields = @{}
    $row = 0
    foreach ($entry in @(@('email','Email do administrador'), @('password','Nova palavra-passe (12 a 256 caracteres)'), @('token','Token Cloudflare - cola aqui com Ctrl+V'))) {
        $label = New-Object System.Windows.Forms.Label
        $label.Text = $entry[1]
        $label.SetBounds(20, (55 + $row * 70), 520, 24)
        $form.Controls.Add($label)
        $box = New-Object System.Windows.Forms.TextBox
        $box.SetBounds(20, (80 + $row * 70), 520, 28)
        $box.UseSystemPasswordChar = $entry[0] -ne 'email'
        $box.MaxLength = if ($entry[0] -eq 'token') { 512 } elseif ($entry[0] -eq 'email') { 254 } else { 256 }
        $form.Controls.Add($box)
        $fields[$entry[0]] = $box
        $row++
    }
    $approval = New-Object System.Windows.Forms.CheckBox
    $approval.Text = 'Autorizo criar Workers, D1 e R2 com os custos Cloudflare aplicaveis.'
    $approval.SetBounds(20, 278, 520, 48)
    $form.Controls.Add($approval)
    $status = New-Object System.Windows.Forms.Label
    $status.SetBounds(20, 330, 520, 32)
    $form.Controls.Add($status)
    $submit = New-Object System.Windows.Forms.Button
    $submit.Text = 'Publicar piloto'
    $submit.SetBounds(355, 370, 185, 32)
    $form.Controls.Add($submit)
    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Text = 'Cancelar'
    $cancel.SetBounds(215, 370, 125, 32)
    $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $form.Controls.Add($cancel)
    $form.AcceptButton = $submit
    $form.CancelButton = $cancel
    return @{ Form = $form; Fields = $fields; Approval = $approval; Status = $status; Submit = $submit }
}

function Confirm-PilotDialog($dialog) {
    if ($dialog.Fields.email.Text.Trim() -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') { return 'Indica um email valido.' }
    if ($dialog.Fields.password.Text.Length -lt 12) { return 'A palavra-passe precisa de pelo menos 12 caracteres.' }
    if ($dialog.Fields.token.Text.Trim() -notmatch '^[A-Za-z0-9_-]{20,512}$') { return 'Cola o token API Cloudflare no campo indicado.' }
    if (-not $dialog.Approval.Checked) { return 'Confirma a autorizacao para criar os recursos.' }
    return ''
}

function Read-PilotSettings {
    $dialog = New-PilotDialog
    $dialog.Submit.Add_Click({
        $message = Confirm-PilotDialog $dialog
        $dialog.Status.Text = $message
        if (-not $message) { $dialog.Form.DialogResult = [System.Windows.Forms.DialogResult]::OK }
    }.GetNewClosure())
    try {
        if ($dialog.Form.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return $null }
        return @{ Email = $dialog.Fields.email.Text.Trim(); Password = $dialog.Fields.password.Text; Token = $dialog.Fields.token.Text.Trim() }
    } finally {
        foreach ($field in $dialog.Fields.Values) { $field.Clear() }
        $dialog.Form.Dispose()
    }
}

try {
    if ($CheckDialog) {
        $dialog = New-PilotDialog
        try {
            if (-not (Confirm-PilotDialog $dialog)) { throw 'O formulario aceitou campos vazios.' }
            $dialog.Fields.email.Text = 'test@example.test'
            $dialog.Fields.password.Text = 'test-password-12345'
            $dialog.Fields.token.Text = 'test-token-value-1234567890'
            if (-not (Confirm-PilotDialog $dialog)) { throw 'O formulario aceitou custos sem autorizacao.' }
            $dialog.Approval.Checked = $true
            if (Confirm-PilotDialog $dialog) { throw 'O formulario recusou dados de teste validos.' }
            if (-not $dialog.Fields.token.UseSystemPasswordChar -or -not $dialog.Fields.password.UseSystemPasswordChar) { throw 'Credenciais sem mascara.' }
            Write-Host 'Formulario validado: campos obrigatorios, autorizacao e credenciais ocultas.'
        } finally { $dialog.Form.Dispose() }
        return
    }
    New-Item -ItemType Directory -Path $temporary | Out-Null
    $staged = Join-Path $temporary 'package'
    Copy-Item -LiteralPath $package -Destination $staged -Recurse
    $private = Join-Path $temporary 'pilot.pem'
    $public = Join-Path $temporary 'public.txt'
    $license = Join-Path $temporary 'pilot.license.json'
    Invoke-GoCommand @('run','-buildvcs=false','./cmd/license-tool','-mode','generate','-private-key',$private,'-public-key',$public)
    Invoke-GoCommand @('run','-buildvcs=false','./cmd/license-tool','-mode','sign-package','-private-key',$private,'-package',$staged)
    Invoke-GoCommand @('run','-buildvcs=false','./cmd/license-tool','-mode','issue','-private-key',$private,'-account',$account,'-order',$purchase,'-out',$license)
    if ($PrepareOnly) {
        Write-Host 'Pacote verificado e assinatura e licenca de teste geradas localmente.'
        return
    }
    Write-Host 'Piloto Food Truck Live | aimiguelazio03.workers.dev'
    Write-Host 'Preenche os dados na janela Food Truck Live. A consola mostra o progresso.'
    $settings = Read-PilotSettings
    if ($null -eq $settings) { Write-Host 'Publicacao cancelada.'; return }
    $env:CLOUDFLARE_API_TOKEN = $settings.Token
    $env:FOODTRUCK_LICENSE_PUBLIC_KEY = (Get-Content -LiteralPath $public -Raw).Trim()
    $event = @{
        id = $purchase; account = $account; packageDirectory = $staged; journalDirectory = $journal
        costsApproved = $true; license = Get-Content -LiteralPath $license -Raw | ConvertFrom-Json
        business = @{ name = 'Food Truck Live Piloto'; email = $settings.Email; password = $settings.Password; address = ''; phone = ''; contactEmail = ''; primaryColor = '#ed8735'; secondaryColor = '#20271f' }
    }
    $OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    Write-Host 'A publicar. Esta etapa pode demorar varios minutos.'
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = 'go'
    $start.WorkingDirectory = $launcher
    $start.Arguments = 'run -buildvcs=false ./cmd/marketplace-pilot'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $start
    try {
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        # .NET Framework (Windows PowerShell 5.1) has no StandardInputEncoding.
        # Write UTF-8 bytes directly, without a BOM or the default console encoding.
        $payload = (New-Object System.Text.UTF8Encoding($false)).GetBytes(($event | ConvertTo-Json -Depth 6 -Compress))
        try {
            $process.StandardInput.BaseStream.Write($payload, 0, $payload.Length)
            $process.StandardInput.BaseStream.Flush()
        } finally {
            $process.StandardInput.Close()
            [Array]::Clear($payload, 0, $payload.Length)
            $payload = $null
        }
        $process.WaitForExit()
        $pilotExit = $process.ExitCode
        $result = $stdout.GetAwaiter().GetResult()
        $stderr.GetAwaiter().GetResult() | Set-Content -LiteralPath $errorLog -Encoding utf8
    } finally { $process.Dispose() }
    if ($pilotExit -ne 0) {
        [Console]::Error.WriteLine('A publicacao parou. O erro ficou guardado em: ' + $errorLog)
        if (Test-Path -LiteralPath $errorLog) { Get-Content -LiteralPath $errorLog | Write-Host }
        throw 'A publicacao nao foi confirmada. O progresso foi guardado para retoma.'
    }
    $result | Set-Content -LiteralPath $resultLog -Encoding utf8
    $result | Write-Host
    Write-Host ('Resultado guardado em: ' + $resultLog)
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    if (-not $PrepareOnly -and -not $CheckDialog) {
        Add-Content -LiteralPath $errorLog -Value $_.Exception.Message -Encoding utf8
    }
    exit 1
} finally {
    $env:CLOUDFLARE_API_TOKEN = $previousToken
    $env:FOODTRUCK_LICENSE_PUBLIC_KEY = $previousKey
    $settings = $null
    $event = $null
    if (Test-Path -LiteralPath $temporary) {
        $resolved = (Resolve-Path -LiteralPath $temporary).Path
        $prefix = (Join-Path $root 'output/distribution/pilot-').Replace('/', '\')
        if ($resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $resolved -Recurse -Force
        }
    }
}
