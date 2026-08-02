[CmdletBinding()]
param(
  [string]$Domain,
  [string]$AdminUsername,
  [Security.SecureString]$AdminPassword,
  [string]$AdminPasswordFile
)

$ErrorActionPreference = 'Stop'
$RootDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$EnvFile = Join-Path $RootDir '.env.production'

if (-not $Domain) { $Domain = Read-Host 'Domain already pointing to this server (for example teacher.example.com)' }
if (-not $AdminUsername) { $AdminUsername = Read-Host 'Administrator username' }

$Domain = $Domain -replace '^https?://', ''
$Domain = $Domain.TrimEnd('/')
if ($Domain -notmatch '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$' -or $Domain -notmatch '\.') {
  throw 'Invalid domain. Enter a hostname without a URL path or port.'
}
if ($AdminUsername.Length -lt 3 -or $AdminUsername.Length -gt 100) {
  throw 'The administrator username must contain 3-100 characters.'
}

$PlainPassword = $null
$PasswordPointer = [IntPtr]::Zero
try {
  if ($AdminPasswordFile) {
    $PlainPassword = ([IO.File]::ReadAllText((Resolve-Path $AdminPasswordFile))).TrimEnd("`r", "`n")
  } else {
    if (-not $AdminPassword) { $AdminPassword = Read-Host 'Administrator password (at least 12 characters)' -AsSecureString }
    $PasswordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($AdminPassword)
    $PlainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($PasswordPointer)
  }
  if ($PlainPassword.Length -lt 12) { throw 'The administrator password must contain at least 12 characters.' }

  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker was not found. Install and start Docker Desktop, then run this script again.'
  }
  & docker info *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Docker is unavailable. Start Docker Desktop and try again.' }
  & docker compose version *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Docker Compose v2 is required.' }

  function Get-EnvValue([string]$File, [string]$Key) {
    if (-not (Test-Path -LiteralPath $File)) { return $null }
    foreach ($Line in [IO.File]::ReadLines($File)) {
      if ($Line.StartsWith("$Key=")) {
        $Value = $Line.Substring($Key.Length + 1).Trim()
        if (($Value.StartsWith('"') -and $Value.EndsWith('"')) -or
            ($Value.StartsWith("'") -and $Value.EndsWith("'"))) {
          return $Value.Substring(1, $Value.Length - 2)
        }
        return $Value
      }
    }
    return $null
  }

  function New-HexSecret([int]$ByteCount = 32) {
    $Bytes = New-Object byte[] $ByteCount
    $Generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $Generator.GetBytes($Bytes) } finally { $Generator.Dispose() }
    return ([BitConverter]::ToString($Bytes)).Replace('-', '').ToLowerInvariant()
  }

  function Test-AdminEntryPath([string]$Value) {
    if (-not $Value -or $Value -notmatch '^/[A-Za-z0-9_-]{40}$') { return $false }
    $Token = $Value.Substring(1)
    return $Token -notmatch '^(?i:admin)' -and
      $Token -cmatch '[A-Z]' -and
      $Token -cmatch '[a-z]' -and
      $Token -match '[0-9]' -and
      $Token -match '[-_]'
  }

  function New-AdminEntryPath {
    $Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    for ($Attempt = 0; $Attempt -lt 100; $Attempt++) {
      $Bytes = New-Object byte[] 40
      $Generator = [Security.Cryptography.RandomNumberGenerator]::Create()
      try { $Generator.GetBytes($Bytes) } finally { $Generator.Dispose() }
      $Token = -join ($Bytes | ForEach-Object { $Alphabet[[int]$_ % 64] })
      $Candidate = "/$Token"
      if (Test-AdminEntryPath $Candidate) { return $Candidate }
    }
    throw 'Unable to generate a secure administrator entry path.'
  }

  $LocalEnv = Join-Path $RootDir '.env.local'
  $SessionSecret = Get-EnvValue $EnvFile 'SESSION_SECRET'
  if (-not $SessionSecret) { $SessionSecret = New-HexSecret }
  $SafetySalt = Get-EnvValue $EnvFile 'SAFETY_ID_SALT'
  if (-not $SafetySalt) { $SafetySalt = New-HexSecret }
  $AdminEntryPath = Get-EnvValue $EnvFile 'ADMIN_ENTRY_PATH'
  if (-not $AdminEntryPath) { $AdminEntryPath = New-AdminEntryPath }
  if (-not (Test-AdminEntryPath $AdminEntryPath)) {
    throw 'ADMIN_ENTRY_PATH in .env.production is invalid. Installation stopped to avoid changing the administrator URL unexpectedly.'
  }
  $OpenAIKey = Get-EnvValue $EnvFile 'OPENAI_API_KEY'
  if (-not $OpenAIKey) { $OpenAIKey = Get-EnvValue $LocalEnv 'OPENAI_API_KEY' }
  $OpenAIBaseUrl = Get-EnvValue $EnvFile 'OPENAI_BASE_URL'
  if (-not $OpenAIBaseUrl) { $OpenAIBaseUrl = Get-EnvValue $LocalEnv 'OPENAI_BASE_URL' }
  if (-not $OpenAIBaseUrl) { $OpenAIBaseUrl = 'https://api.openai.com/v1' }
  $OpenAIModel = Get-EnvValue $EnvFile 'OPENAI_MODEL'
  if (-not $OpenAIModel) { $OpenAIModel = Get-EnvValue $LocalEnv 'OPENAI_MODEL' }
  if (-not $OpenAIModel) { $OpenAIModel = 'gpt-5.6' }

  $Lines = @(
    "DOMAIN=$Domain"
    "PUBLIC_BASE_URL=https://$Domain"
    "OPENAI_API_KEY=$OpenAIKey"
    "OPENAI_BASE_URL=$OpenAIBaseUrl"
    "OPENAI_MODEL=$OpenAIModel"
    'OPENAI_REASONING_EFFORT=medium'
    'OPENAI_IMAGE_DETAIL=high'
    'OPENAI_MAX_OUTPUT_TOKENS=24000'
    'AI_REQUEST_TIMEOUT_MS=180000'
    'MAX_BODY_BYTES=26214400'
    'MAX_IMAGE_BYTES=8388608'
    'MAX_PDF_BYTES=16777216'
    'MAX_IMAGES=12'
    "SESSION_SECRET=$SessionSecret"
    "SAFETY_ID_SALT=$SafetySalt"
    "ADMIN_ENTRY_PATH=$AdminEntryPath"
  )
  [IO.File]::WriteAllLines($EnvFile, $Lines, [Text.UTF8Encoding]::new($false))

  Push-Location $RootDir
  try {
    Write-Host 'Building the application image...'
    & docker compose --env-file $EnvFile build app
    if ($LASTEXITCODE -ne 0) { throw 'The image build failed.' }

    Write-Host 'Initializing the administrator securely...'
    $PlainPassword | & docker compose --env-file $EnvFile run --rm -T -e "ADMIN_USERNAME=$AdminUsername" app node server/index.mjs --bootstrap-admin
    if ($LASTEXITCODE -ne 0) { throw 'Administrator initialization failed.' }
    $PlainPassword = $null

    Write-Host 'Starting services...'
    & docker compose --env-file $EnvFile up -d --remove-orphans
    if ($LASTEXITCODE -ne 0) { throw 'Container startup failed.' }

    $Healthy = $false
    for ($Attempt = 0; $Attempt -lt 30; $Attempt++) {
      & docker compose --env-file $EnvFile exec -T app node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" *> $null
      if ($LASTEXITCODE -eq 0) { $Healthy = $true; break }
      Start-Sleep -Seconds 2
    }
    if (-not $Healthy) { throw 'Containers started, but the health check did not pass. Inspect the Compose logs.' }

    Write-Host "Deployment complete: https://$Domain"
    Write-Host "Administrator entry: https://$Domain$AdminEntryPath"
    Write-Host 'Keep this URL private. You can recover it from ADMIN_ENTRY_PATH in .env.production.'
    Write-Host 'Caddy will obtain and renew the certificate automatically. Initial issuance can take about a minute.'
  } finally {
    Pop-Location
  }
} finally {
  $PlainPassword = $null
  if ($PasswordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($PasswordPointer)
  }
}
