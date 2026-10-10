param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9.-]*$')][string]$Server,
    [ValidatePattern('^[A-Za-z_][A-Za-z0-9_-]*$')][string]$User = 'root',
    [ValidateRange(1, 65535)][int]$Port = 22,
    [string]$IdentityFile,
    [string]$KnownHostsFile,
    [ValidateRange(1, 65535)][int]$LocalPort = 3001
)
$ErrorActionPreference = 'Stop'
$tunnelArgs = @('-N', '-T', '-p', [string]$Port,
    '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=30',
    '-L', "127.0.0.1:$($LocalPort):127.0.0.1:3001")
if ($IdentityFile) {
    if (-not (Test-Path -LiteralPath $IdentityFile -PathType Leaf)) { throw 'IdentityFile does not exist.' }
    $tunnelArgs += @('-o', 'IdentitiesOnly=yes', '-i', (Resolve-Path -LiteralPath $IdentityFile).Path)
}
if ($KnownHostsFile) {
    if (-not (Test-Path -LiteralPath $KnownHostsFile -PathType Leaf)) { throw 'KnownHostsFile does not exist.' }
    $tunnelArgs += @('-o', ('UserKnownHostsFile=' + (Resolve-Path -LiteralPath $KnownHostsFile).Path))
}
$tunnelArgs += "$User@$Server"
# Quote native arguments because Start-Process joins ArgumentList with spaces.
$quotedArgs = $tunnelArgs | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }
Start-Process -FilePath ssh -ArgumentList $quotedArgs -WindowStyle Hidden
Write-Host "ChisaBot SSH tunnel requested. Open http://localhost:$LocalPort once the server is healthy."
