<#
  Richtet das Supabase-Backend fuer das Content-Stellwerk komplett ein:
    1. Supabase-Login (Browser)
    2. Projekt verknuepfen
    3. Datenbank anlegen (Tabellen, Rechte, Startdaten)
    4. Twitch-Zugangsdaten, Admin-Passwort + Secrets setzen
    5. Edge Functions deployen
    6. js/config.js mit URL + oeffentlichem Key fuellen

  Voraussetzung: Node.js (fuer npx) und ein angelegtes Supabase-Projekt.
  Start:   powershell -ExecutionPolicy Bypass -File .\setup-supabase.ps1
  Update:  powershell -ExecutionPolicy Bypass -File .\setup-supabase.ps1 -Update
           (nur Datenbank + Functions aktualisieren, keine Passwort-Abfragen)
#>
param(
  [string]$ProjectRef = 'ssibsphuttjlphijilsc',
  [string]$SiteUrl = 'https://spitzefluke.github.io/twitch-content/',
  [string]$BroadcasterLogin = 'zugfahrer_davetv',
  [int]$RewardCost = 10000,
  [switch]$Update
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Yellow }
function Info($text) { Write-Host "    $text" -ForegroundColor Gray }

# npx.cmd statt npx: der PowerShell-Wrapper npx.ps1 macht aus jeder Meldung auf stderr einen Fehler
function Invoke-Supabase {
  & npx.cmd --yes supabase@latest @args
  if ($LASTEXITCODE -ne 0) { throw "Supabase-CLI fehlgeschlagen: supabase $($args -join ' ')" }
}

# ---------------------------------------------------------------- 1. Login
Step 'Supabase-Login'
function Test-SupabaseLogin {
  # Windows PowerShell 5.1 wertet umgeleitete stderr-Ausgaben sonst als Abbruch
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & npx.cmd --yes supabase@latest projects list 2>&1 | Out-Null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  } finally {
    $ErrorActionPreference = $old
  }
}

if (-not (Test-SupabaseLogin)) {
  Info 'Es oeffnet sich gleich der Browser. Bitte bei Supabase anmelden und bestaetigen.'
  Invoke-Supabase login
} else {
  Info 'Bereits angemeldet.'
}

# ---------------------------------------------------------------- 2. Projekt
Step 'Projekt auswaehlen'
if (-not $ProjectRef) {
  Invoke-Supabase projects list
  Info 'Die "REFERENCE ID" steht in der Tabelle oben (z. B. abcdefghijklmnopqrst).'
  $ProjectRef = (Read-Host '    Reference ID deines Projekts').Trim()
}
if ($ProjectRef -notmatch '^[a-z0-9]{20}$') { throw "Das sieht nicht wie eine Reference ID aus: $ProjectRef" }
$SupabaseUrl = "https://$ProjectRef.supabase.co"

$linkedFile = Join-Path $PSScriptRoot 'supabase\.temp\project-ref'
$linked = (Test-Path $linkedFile) -and ((Get-Content $linkedFile -Raw).Trim() -eq $ProjectRef)
if ($linked) {
  Info "Projekt $ProjectRef ist bereits verknuepft."
} else {
  Info 'Beim Verknuepfen fragt die CLI evtl. nach dem Datenbank-Passwort (beim Anlegen des Projekts festgelegt).'
  Invoke-Supabase link --project-ref $ProjectRef
}

# ---------------------------------------------------------------- 3. Datenbank
Step 'Datenbank einrichten'
Invoke-Supabase db push --yes

if ($Update) {
  Step 'Edge Functions deployen'
  Invoke-Supabase functions deploy --use-api --no-verify-jwt --project-ref $ProjectRef
  Write-Host ''
  Write-Host 'Update fertig! Datenbank und Functions sind aktuell.' -ForegroundColor Green
  exit 0
}

# ---------------------------------------------------------------- 4. Twitch + Admin + Secrets
function Read-Secret($prompt) {
  $secure = Read-Host $prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

Step 'Twitch-App'
$RedirectUrl = "$SupabaseUrl/functions/v1/twitch-oauth"
Write-Host ''
Write-Host '    Lege auf https://dev.twitch.tv/console/apps eine App an (falls noch nicht geschehen):' -ForegroundColor Cyan
Write-Host "      OAuth Redirect URL:  $RedirectUrl" -ForegroundColor Cyan
Write-Host '      Kategorie:           Website Integration' -ForegroundColor Cyan
Write-Host '      Client-Typ:          Confidential' -ForegroundColor Cyan
Write-Host '    Danach "Manage" -> Client ID kopieren und "New Secret" erzeugen.' -ForegroundColor Cyan
Write-Host '    Schon erledigt und Secrets gesetzt? Dann einfach Enter druecken zum Ueberspringen.' -ForegroundColor Cyan
Write-Host ''
try { Set-Clipboard -Value $RedirectUrl; Info '(Redirect URL ist in der Zwischenablage.)' } catch { }

$lines = @()
$ClientId = (Read-Host '    Twitch Client ID').Trim()
if ($ClientId) {
  $ClientSecret = (Read-Secret '    Twitch Client Secret (Eingabe unsichtbar)').Trim()
  if (-not $ClientSecret) { throw 'Ohne Client Secret geht es nicht.' }

  # Zufaelliges Webhook-Secret (48 Zeichen), mit dem Twitch seine Nachrichten signiert
  $chars = [char[]]'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  $bytes = New-Object byte[] 48
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $EventSubSecret = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })

  $lines += @(
    "TWITCH_CLIENT_ID=$ClientId"
    "TWITCH_CLIENT_SECRET=$ClientSecret"
    "EVENTSUB_SECRET=$EventSubSecret"
  )
} else {
  Info 'Twitch uebersprungen - vorhandene Twitch-Secrets bleiben unveraendert.'
}

Step 'Admin-Passwort'
Info 'Damit meldest du dich auf admin.html an (ohne Registrierung).'
Info 'Mindestens 12 Zeichen. Enter = ueberspringen (vorhandenes Passwort bleibt).'
$AdminPassword = Read-Secret '    Neues Admin-Passwort (Eingabe unsichtbar)'
if ($AdminPassword) {
  if ($AdminPassword.Length -lt 12) { throw 'Das Admin-Passwort muss mindestens 12 Zeichen lang sein.' }
  if ($AdminPassword.Contains("'")) { throw 'Bitte kein Apostroph ('') im Admin-Passwort verwenden.' }
  $repeat = Read-Secret '    Admin-Passwort wiederholen'
  if ($repeat -ne $AdminPassword) { throw 'Die Passwoerter stimmen nicht ueberein.' }
  # in einfachen Anfuehrungszeichen, damit $ oder # im Passwort nicht umgedeutet werden
  $lines += "ADMIN_PASSWORD='$AdminPassword'"
} else {
  Info 'Admin-Passwort uebersprungen.'
}

Step 'Secrets setzen'
$lines += @(
  "SITE_URL=$SiteUrl"
  "BROADCASTER_LOGIN=$BroadcasterLogin"
  "REWARD_TITLE=Gl$([char]0x00FC)cksrad"
  "REWARD_COST=$RewardCost"
)
$envFile = Join-Path $env:TEMP "stellwerk-secrets-$([guid]::NewGuid()).env"
try {
  # UTF-8 ohne BOM, sonst liest die CLI den ersten Namen falsch
  [IO.File]::WriteAllLines($envFile, [string[]]$lines, (New-Object Text.UTF8Encoding $false))
  Invoke-Supabase secrets set --env-file $envFile --project-ref $ProjectRef
} finally {
  Remove-Item $envFile -Force -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------- 5. Functions
Step 'Edge Functions deployen'
Invoke-Supabase functions deploy --use-api --no-verify-jwt --project-ref $ProjectRef

# ---------------------------------------------------------------- 6. config.js
Step 'js/config.js aktualisieren'
$keysJson = (& npx.cmd --yes supabase@latest projects api-keys --project-ref $ProjectRef -o json) -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'API-Keys konnten nicht gelesen werden.' }
$keys = $keysJson | ConvertFrom-Json
$publicKey = ($keys | Where-Object { $_.name -eq 'anon' } | Select-Object -First 1).api_key
if (-not $publicKey) { $publicKey = ($keys | Where-Object { $_.type -eq 'publishable' } | Select-Object -First 1).api_key }
if (-not $publicKey) { throw 'Kein oeffentlicher (anon/publishable) Key gefunden.' }

$configPath = Join-Path $PSScriptRoot 'js\config.js'
$config = [IO.File]::ReadAllText($configPath)
$config = $config -replace "SUPABASE_URL:\s*'[^']*'", "SUPABASE_URL: '$SupabaseUrl'"
$config = $config -replace "SUPABASE_ANON_KEY:\s*'[^']*'", "SUPABASE_ANON_KEY: '$publicKey'"
[IO.File]::WriteAllText($configPath, $config, (New-Object Text.UTF8Encoding $false))
Info "SUPABASE_URL = $SupabaseUrl"

# ---------------------------------------------------------------- Fertig
Write-Host ''
Write-Host 'Fertig! Noch zwei kurze Schritte:' -ForegroundColor Green
Write-Host ''
Write-Host "  1. Supabase-Dashboard -> Authentication -> URL Configuration" -ForegroundColor Green
Write-Host "       Site URL:      $SiteUrl" -ForegroundColor Green
Write-Host "       Redirect URLs: $SiteUrl" -ForegroundColor Green
Write-Host "     https://supabase.com/dashboard/project/$ProjectRef/auth/url-configuration" -ForegroundColor DarkGray
Write-Host ''
Write-Host '  2. config.js hochladen:' -ForegroundColor Green
Write-Host '       git add js/config.js' -ForegroundColor Green
Write-Host '       git commit -m "Supabase verbinden"' -ForegroundColor Green
Write-Host '       git push' -ForegroundColor Green
Write-Host ''
Write-Host "Danach auf $SiteUrl registrieren und oben rechts 'Mit Twitch verbinden' klicken." -ForegroundColor Green
Write-Host "Admin-Bereich: $($SiteUrl)admin.html" -ForegroundColor Green
