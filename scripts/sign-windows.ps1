param([Parameter(Mandatory = $true, Position = 0)][string]$Path)
$ErrorActionPreference = 'Stop'
foreach ($name in @('AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TENANT_ID', 'AZURE_SIGNING_ENDPOINT', 'AZURE_SIGNING_ACCOUNT', 'AZURE_SIGNING_PROFILE')) {
    if (-not [Environment]::GetEnvironmentVariable($name)) { throw "Missing signing configuration: $name" }
}
$resolved = (Resolve-Path -LiteralPath $Path).Path
& artifact-signing-cli -e $env:AZURE_SIGNING_ENDPOINT -a $env:AZURE_SIGNING_ACCOUNT -c $env:AZURE_SIGNING_PROFILE -d Forever $resolved
if ($LASTEXITCODE -ne 0) { throw "Azure Artifact Signing failed with exit code $LASTEXITCODE." }
$signature = Get-AuthenticodeSignature -LiteralPath $resolved
if ($signature.Status -ne 'Valid' -or -not $signature.TimeStamperCertificate) {
    throw "Signing did not produce a valid, timestamped Authenticode signature."
}
