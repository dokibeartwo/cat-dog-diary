param([switch]$KeepOldReleases)
# Legacy flag retained; old ZIPs are now always preserved.
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$electronDist = Join-Path $projectRoot "node_modules\electron\dist"
$releaseRoot = Join-Path $projectRoot "release"
$package = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$productName = -join @([char]0x732B, [char]0x72D7, [char]0x65E5, [char]0x8BB0)
$productVersion = [string]$package.version
if ($productVersion -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw "Invalid package version." }
$fileVersion = ($productVersion -split '-')[0]
$directoryName = $productName + "-windows-x64"
$archiveName = $productName + "-" + $productVersion + "-windows-x64.zip"
$outputRoot = Join-Path $releaseRoot $directoryName
$archivePath = Join-Path $releaseRoot $archiveName
$iconPath = Join-Path $projectRoot "src\renderer\assets\cat-dog-diary.ico"
$resourceEditor = Join-Path $projectRoot "node_modules\rcedit\bin\rcedit-x64.exe"
$buildId = (Get-Date -Format "yyyyMMdd-HHmmss") + "-" + [Guid]::NewGuid().ToString("N").Substring(0, 8)
$candidateBase = Join-Path $releaseRoot (".candidate-" + $buildId)
$candidateRoot = Join-Path $candidateBase $directoryName
$candidateArchive = Join-Path $candidateBase $archiveName
$previousRoot = Join-Path $releaseRoot (".previous-" + $buildId)
$previousOutput = Join-Path $previousRoot $directoryName
$previousArchive = Join-Path $previousRoot $archiveName
$releaseFull = [System.IO.Path]::GetFullPath($releaseRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
function Assert-ReleaseChild([string]$Target) {
  $resolved = [System.IO.Path]::GetFullPath($Target)
  if (-not $resolved.StartsWith($releaseFull + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing a file operation outside the release folder: $resolved"
  }
  return $resolved
}
function Get-FileSha256([string]$FilePath) {
  $stream = [System.IO.File]::OpenRead($FilePath)
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    return [System.BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace("-", "")
  } finally {
    $algorithm.Dispose()
    $stream.Dispose()
  }
}
foreach ($target in @($outputRoot, $archivePath, $candidateBase, $candidateRoot, $candidateArchive, $previousRoot, $previousOutput, $previousArchive)) {
  Assert-ReleaseChild $target | Out-Null
}
if (-not (Test-Path -LiteralPath (Join-Path $electronDist "electron.exe") -PathType Leaf)) {
  throw "Electron runtime is missing. Run npm ci, then node node_modules/electron/install.js."
}
if (-not (Test-Path -LiteralPath $resourceEditor -PathType Leaf)) {
  throw "Project-local rcedit is missing. Run npm ci; no personal build cache is used."
}
& (Join-Path $PSScriptRoot "build-icon.ps1")
New-Item -ItemType Directory -Path $candidateRoot -Force | Out-Null
Get-ChildItem -LiteralPath $electronDist -Force | Copy-Item -Destination $candidateRoot -Recurse -Force
$candidateExecutable = Join-Path $candidateRoot ($productName + ".exe")
Rename-Item -LiteralPath (Join-Path $candidateRoot "electron.exe") -NewName ($productName + ".exe")
& $resourceEditor $candidateExecutable --set-icon $iconPath --set-version-string ProductName $productName --set-version-string FileDescription ($productName + " desktop productivity assistant") --set-file-version $fileVersion --set-product-version $fileVersion
if ($LASTEXITCODE -ne 0) { throw "Failed to apply executable metadata. Candidate retained: $candidateRoot" }

$appRoot = Join-Path $candidateRoot "resources\app"
New-Item -ItemType Directory -Path $appRoot -Force | Out-Null
Copy-Item -LiteralPath $iconPath -Destination (Join-Path $candidateRoot ($productName + ".ico"))
# Preserve isolated QA modules: the final EXE accepts --qa-v1 / --qa-windows.
Copy-Item -LiteralPath (Join-Path $projectRoot "src") -Destination (Join-Path $appRoot "src") -Recurse
New-Item -ItemType Directory -Path (Join-Path $appRoot "packages") -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot "packages\core") -Destination (Join-Path $appRoot "packages\core") -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot "package.json") -Destination (Join-Path $appRoot "package.json")
if ($productVersion.Contains('-')) {
  # Keep prerelease data outside the versioned app folder and out of the ZIP.
  @{ version = 1; directory = ("../" + (-join @([char]0x672C,[char]0x5730,[char]0x6570,[char]0x636E))) } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $candidateRoot 'data-location.json') -Encoding UTF8
  Copy-Item -LiteralPath (Join-Path $projectRoot 'RELEASE-1.1.0-BETA.3.md') -Destination (Join-Path $candidateRoot 'RELEASE-1.1.0-BETA.3.md')
}
$guideName = (-join @([char]0x4F7F, [char]0x7528, [char]0x8BF4, [char]0x660E)) + ".md"
foreach ($document in @("README.md", $guideName, "RELEASE-1.0.0.md", "PRIVACY.md", "ASSETS.md")) {
  $source = Join-Path $projectRoot $document
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Release document missing: $source" }
  Copy-Item -LiteralPath $source -Destination (Join-Path $candidateRoot $document)
}
Copy-Item -LiteralPath (Join-Path $projectRoot $guideName) -Destination (Join-Path $candidateRoot ([System.IO.Path]::ChangeExtension($guideName, ".txt")))
foreach ($required in @($candidateExecutable, (Join-Path $appRoot "src\main.js"), (Join-Path $appRoot "src\renderer\reminder.html"), (Join-Path $candidateRoot "LICENSE"), (Join-Path $candidateRoot "LICENSES.chromium.html"))) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Incomplete candidate: $required" }
}
$builtPackage = Get-Content -LiteralPath (Join-Path $appRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
if ($builtPackage.version -ne $productVersion) { throw "Packaged version does not match source." }
$electronVersion = (Get-Content -LiteralPath (Join-Path $projectRoot "node_modules\electron\package.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version
@{ product = $productName; version = $productVersion; electron = $electronVersion; builtAtUtc = [DateTime]::UtcNow.ToString("o"); signed = $false; executableSha256 = (Get-FileSha256 $candidateExecutable); packageLockSha256 = (Get-FileSha256 (Join-Path $projectRoot "package-lock.json")) } |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $candidateRoot "BUILD-INFO.json") -Encoding UTF8
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($candidateRoot, $candidateArchive, [System.IO.Compression.CompressionLevel]::Optimal, $true)
if ((Get-Item -LiteralPath $candidateArchive).Length -le 0) { throw "Archive is empty." }
$archiveSha256 = Get-FileSha256 $candidateArchive

# Complete and compress the candidate before touching the current output.
# Use same-volume renames, keep the old build, and restore it on failure.
$movedOldOutput = $false
$movedOldArchive = $false
$promotedOutput = $false
$promotedArchive = $false
try {
  if ((Test-Path -LiteralPath $outputRoot) -or (Test-Path -LiteralPath $archivePath)) { New-Item -ItemType Directory -Path $previousRoot | Out-Null }
  if (Test-Path -LiteralPath $outputRoot) {
    Move-Item -LiteralPath (Assert-ReleaseChild $outputRoot) -Destination (Assert-ReleaseChild $previousOutput)
    $movedOldOutput = $true
  }
  if (Test-Path -LiteralPath $archivePath) {
    Move-Item -LiteralPath (Assert-ReleaseChild $archivePath) -Destination (Assert-ReleaseChild $previousArchive)
    $movedOldArchive = $true
  }
  Move-Item -LiteralPath (Assert-ReleaseChild $candidateRoot) -Destination (Assert-ReleaseChild $outputRoot)
  $promotedOutput = $true
  Move-Item -LiteralPath (Assert-ReleaseChild $candidateArchive) -Destination (Assert-ReleaseChild $archivePath)
  $promotedArchive = $true
} catch {
  $promotionFailure = $_
  try {
    if ($promotedArchive) { Move-Item -LiteralPath (Assert-ReleaseChild $archivePath) -Destination (Assert-ReleaseChild $candidateArchive) }
    if ($promotedOutput) { Move-Item -LiteralPath (Assert-ReleaseChild $outputRoot) -Destination (Assert-ReleaseChild $candidateRoot) }
    if ($movedOldArchive) { Move-Item -LiteralPath (Assert-ReleaseChild $previousArchive) -Destination (Assert-ReleaseChild $archivePath) }
    if ($movedOldOutput) { Move-Item -LiteralPath (Assert-ReleaseChild $previousOutput) -Destination (Assert-ReleaseChild $outputRoot) }
  } catch { Write-Warning "Rollback requires inspection. Previous files remain under $previousRoot. $($_.Exception.Message)" }
  throw $promotionFailure
}
# Remove the now-empty container only; never recursively remove build output.
Remove-Item -LiteralPath (Assert-ReleaseChild $candidateBase)
$checksumPath = Join-Path $releaseRoot ("SHA256SUMS-" + $productVersion + ".txt")
"$archiveSha256  $archiveName" | Set-Content -LiteralPath (Assert-ReleaseChild $checksumPath) -Encoding UTF8
Write-Output "Executable: $(Join-Path $outputRoot ($productName + '.exe'))"
Write-Output "Archive:    $archivePath"
Write-Output "SHA256:     $archiveSha256"
if ($movedOldOutput -or $movedOldArchive) { Write-Output "Rollback:   $previousRoot" }
Write-Output "Old ZIPs were retained. Run isolated packaged QA before installing this candidate."
