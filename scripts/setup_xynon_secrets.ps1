# Install Xynon's public JWT key and an independent email HMAC key.
# The Clerk Secret Key must already have been installed through Wrangler's prompt.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot 'wrangler.xynon.jsonc'
$wranglerEntry = Join-Path $projectRoot 'node_modules\wrangler\bin\wrangler.js'
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($config.name -ne 'choir-assistant-xynon-staging' -or
    $config.vars.APP_ORIGIN -ne 'https://staging.xynon.it' -or
    $config.vars.CLERK_FRONTEND_API_ORIGIN -ne 'https://clerk.staging.xynon.it') {
    throw 'La configurazione non identifica lo staging Xynon previsto.'
}

$secretJson = & node $wranglerEntry secret list --config $configPath
if ($LASTEXITCODE -ne 0) { throw 'Impossibile leggere i nomi dei secret Xynon.' }
$secretNames = @($secretJson | ConvertFrom-Json | ForEach-Object { $_.name })
if ($secretNames -notcontains 'CLERK_SECRET_KEY') {
    throw 'Installare prima CLERK_SECRET_KEY tramite il prompt interattivo di Wrangler.'
}

$vaultDirectory = Join-Path $env:LOCALAPPDATA 'ChoirAssistant\Xynon'
$hmacPath = Join-Path $vaultDirectory 'auth-email-hmac.dpapi'
if ((Test-Path -LiteralPath $hmacPath) -eq $false -and
    $secretNames -contains 'AUTH_EMAIL_HMAC_KEY') {
    throw 'Il secret HMAC esiste gia ma manca la copia locale: recuperarla dal backup senza ruotare la chiave.'
}

# DPAPI binds the recovery copy to this Windows user. No plaintext secret file.
if (Test-Path -LiteralPath $hmacPath) {
    $secureHmac = Get-Content -LiteralPath $hmacPath -Raw | ConvertTo-SecureString
} else {
    $randomBytes = New-Object byte[] 32
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($randomBytes) } finally { $random.Dispose() }
    $secureHmac = ConvertTo-SecureString -String ([Convert]::ToBase64String($randomBytes)) -AsPlainText -Force
    [Array]::Clear($randomBytes, 0, $randomBytes.Length)
    New-Item -ItemType Directory -Path $vaultDirectory -Force | Out-Null
    $encrypted = ConvertFrom-SecureString -SecureString $secureHmac
    $stream = [IO.File]::Open($hmacPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    $writer = New-Object IO.StreamWriter($stream, [Text.Encoding]::ASCII)
    try { $writer.Write($encrypted) } finally { $writer.Dispose() }
}

$jwtSource = @'
const { createPublicKey } = require('node:crypto');
(async () => {
  const response = await fetch('https://clerk.staging.xynon.it/.well-known/jwks.json');
  if (!response.ok) throw new Error('JWKS HTTP ' + response.status);
  const jwks = await response.json();
  const keys = jwks.keys.filter(key => key.kty === 'RSA' && (!key.use || key.use === 'sig'));
  if (keys.length !== 1) throw new Error('Expected exactly one Clerk RSA signing key');
  process.stdout.write(createPublicKey({ key: keys[0], format: 'jwk' }).export({ type: 'spki', format: 'pem' }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
'@
$jwtPem = $jwtSource | & node -
if ($LASTEXITCODE -ne 0 -or -not ($jwtPem -match 'BEGIN PUBLIC KEY')) {
    throw 'Impossibile ottenere la chiave pubblica JWT della nuova istanza Clerk.'
}
$jwtPem | & node $wranglerEntry secret put CLERK_JWT_KEY --config $configPath
if ($LASTEXITCODE -ne 0) { throw 'Installazione CLERK_JWT_KEY non riuscita.' }

if ($secretNames -notcontains 'AUTH_EMAIL_HMAC_KEY') {
    $plainHmac = (New-Object Net.NetworkCredential('', $secureHmac)).Password
    try {
        $plainHmac | & node $wranglerEntry secret put AUTH_EMAIL_HMAC_KEY --config $configPath
        if ($LASTEXITCODE -ne 0) { throw 'Installazione AUTH_EMAIL_HMAC_KEY non riuscita.' }
    } finally {
        Remove-Variable plainHmac -ErrorAction SilentlyContinue
    }
}
$secureHmac.Dispose()
Write-Output "Secret Xynon installati. Copia HMAC cifrata per questo utente Windows: $hmacPath"
