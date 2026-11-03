# Installs or updates Folio on Windows, with nothing else to install first. In PowerShell:
#   irm https://raw.githubusercontent.com/akamoe/research-platform/main/scripts/install.ps1 | iex
# It puts its own copy of Node.js and Folio in %LOCALAPPDATA%\Folio, adds a Folio icon to the
# Desktop and Start menu, and opens Folio. Your projects stay in %USERPROFILE%\ResearchPlatform;
# running this again updates Folio without touching them.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$FolioHome = if ($env:FOLIO_HOME) { $env:FOLIO_HOME } else { Join-Path $env:LOCALAPPDATA 'Folio' }
$Repo = if ($env:FOLIO_REPO) { $env:FOLIO_REPO } else { 'akamoe/research-platform' }
$Branch = if ($env:FOLIO_BRANCH) { $env:FOLIO_BRANCH } else { 'main' }
$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }

function Say($msg) { Write-Host "`n  $msg" }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("folio-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $tmp, $FolioHome | Out-Null
$Node = Join-Path $FolioHome 'node\node.exe'

try {
  # 1. Node.js (latest 22.x LTS), checked against nodejs.org's checksums.
  $sums = (Invoke-WebRequest -UseBasicParsing 'https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt').Content
  if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
  $line = ($sums -split "`n" | Where-Object { $_ -match " node-v[\d.]+-win-$Arch\.zip$" } | Select-Object -First 1).Trim()
  $hash, $file = $line -split '\s+'
  $version = ($file -split '-')[1]
  $have = if (Test-Path $Node) { & $Node --version } else { '' }
  if ($have -ne $version) {
    Say "Downloading Node.js $version..."
    Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/latest-v22.x/$file" -OutFile "$tmp\$file"
    if ((Get-FileHash "$tmp\$file" -Algorithm SHA256).Hash -ne $hash.ToUpper()) { throw 'The Node.js download is damaged. Please try again.' }
    Expand-Archive "$tmp\$file" -DestinationPath $tmp
    if (Test-Path "$FolioHome\node") { Remove-Item -Recurse -Force "$FolioHome\node" }
    Move-Item (Join-Path $tmp ($file -replace '\.zip$', '')) "$FolioHome\node"
  }

  # 2. Folio itself. Stop a running copy first so it can be replaced.
  $launch = Join-Path $FolioHome 'app\scripts\launch.mjs'
  if (Test-Path $launch) { & $Node $launch --stop | Out-Null }
  Say 'Downloading Folio...'
  # The exact commit, so Settings > Check for updates knows which version this is.
  $commit = try { (Invoke-RestMethod -UseBasicParsing "https://api.github.com/repos/$Repo/commits/$Branch").sha } catch { $null }
  $ref = if ($commit) { $commit } else { "refs/heads/$Branch" }
  Invoke-WebRequest -UseBasicParsing "https://codeload.github.com/$Repo/zip/$ref" -OutFile "$tmp\folio.zip"
  Expand-Archive "$tmp\folio.zip" -DestinationPath "$tmp\src"
  if (Test-Path "$FolioHome\app") { Remove-Item -Recurse -Force "$FolioHome\app" }
  Move-Item (Get-ChildItem "$tmp\src" -Directory | Select-Object -First 1).FullName "$FolioHome\app"
  if ($commit) { Set-Content -Encoding ascii -Path "$FolioHome\app\.folio-version" -Value "{`"sha`":`"$commit`"}" }

  # 3. Install its parts, build it, make the icons and open it.
  & $Node $launch --setup
  if ($LASTEXITCODE -ne 0) { throw 'Setting up Folio failed.' }
  & $Node (Join-Path $FolioHome 'app\scripts\shortcut.mjs')
  & $Node $launch --background
  Say 'Folio is installed and open in your browser. Next time, open it from the Folio icon on your Desktop or in the Start menu.'
}
finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
