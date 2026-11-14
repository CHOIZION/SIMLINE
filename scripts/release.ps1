$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$outputRoot = Join-Path $projectRoot 'dist'
$version = (Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'package.json') | ConvertFrom-Json).version
$shortVer = ($version -split '\.')[0..1] -join '.'
$appDirectory = Join-Path $outputRoot "SIMLINE-$shortVer-win32-x64"
$ts4Script = Join-Path $outputRoot 'SIMLINE_Sims4_Sync.ts4script'

if (-not (Test-Path -LiteralPath $ts4Script)) {
    & (Join-Path $PSScriptRoot 'build_ts4script.ps1') -ProjectRoot $projectRoot -OutFile $ts4Script
}
if (-not (Test-Path -LiteralPath (Join-Path $appDirectory 'SIMLINE.exe'))) {
    throw "Run package script first. Missing $appDirectory\SIMLINE.exe"
}

$releaseRoot = Join-Path $outputRoot "GitHub-v$version"
$null = New-Item -Path $releaseRoot -ItemType Directory -Force
$applicationZip = Join-Path $releaseRoot "SIMLINE-$version-Windows-x64.zip"
$sourceZip = Join-Path $releaseRoot "SIMLINE-$version-source.zip"
$releaseTs4Script = Join-Path $releaseRoot 'SIMLINE_Sims4_Sync.ts4script'

function Get-RelPath([string]$BaseDir, [string]$FullPath) {
    $normBase = [IO.Path]::GetFullPath($BaseDir).TrimEnd('\') + '\'
    $normFull = [IO.Path]::GetFullPath($FullPath)
    if ($normFull.StartsWith($normBase, [StringComparison]::OrdinalIgnoreCase)) {
        return $normFull.Substring($normBase.Length).Replace('\', '/')
    }
    return [IO.Path]::GetFileName($normFull)
}

function Write-BundleArchive([string]$Destination, $EntryList) {
    $temp = $Destination + '.tmp'
    $stream = [IO.File]::Open($temp, [IO.FileMode]::Create)
    try {
        $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $true)
        try {
            foreach ($entry in $EntryList) {
                $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $entry.Path, $entry.Name, [IO.Compression.CompressionLevel]::Optimal)
            }
        } finally { $archive.Dispose() }
    } finally { $stream.Dispose() }
    if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Force }
    [IO.File]::Move($temp, $Destination)
}

$runtimeEntries = foreach ($file in Get-ChildItem -LiteralPath $appDirectory -Recurse -File) {
    @{Path=$file.FullName;Name=('SIMLINE/' + (Get-RelPath $appDirectory $file.FullName))}
}
Write-BundleArchive $applicationZip $runtimeEntries

$sourceItems = @(
    'README.md','RELEASE.md','사용안내.txt','.gitignore','package.json','pnpm-lock.yaml','pnpm-workspace.yaml',
    'index.html','app.js','unified.js','families.js','family-ui.js','editor.js','editor.css','family.css',
    'core.js','sims4-sync.js','sims4-host.cjs','style.css','worker.js','main.cjs','preload.cjs','store.cjs',
    'sims4_mod','assets','scripts','tests'
)
$sourceEntries = foreach ($item in $sourceItems) {
    $path = Join-Path $projectRoot $item
    if (-not (Test-Path -LiteralPath $path)) { continue }
    if ((Get-Item -LiteralPath $path).PSIsContainer) {
        foreach ($file in Get-ChildItem -LiteralPath $path -Recurse -File) {
            @{Path=$file.FullName;Name=('SIMLINE-source/' + (Get-RelPath $projectRoot $file.FullName))}
        }
    } else {
        @{Path=$path;Name=('SIMLINE-source/' + $item)}
    }
}
Write-BundleArchive $sourceZip $sourceEntries

Copy-Item -LiteralPath $ts4Script -Destination $releaseTs4Script -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'RELEASE.md') -Destination (Join-Path $releaseRoot 'RELEASE.md') -Force

$checksums = foreach ($file in @($applicationZip, $releaseTs4Script, $sourceZip)) {
    (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + [IO.Path]::GetFileName($file)
}
[IO.File]::WriteAllLines((Join-Path $releaseRoot 'SHA256SUMS.txt'), $checksums)

foreach ($file in @($applicationZip, $releaseTs4Script, $sourceZip)) {
    if ($file -like '*.zip') {
        $archive = [IO.Compression.ZipFile]::OpenRead($file)
        try {
            [PSCustomObject]@{File=[IO.Path]::GetFileName($file);Entries=$archive.Entries.Count;Bytes=(Get-Item $file).Length;SHA256=(Get-FileHash $file -Algorithm SHA256).Hash}
        } finally { $archive.Dispose() }
    } else {
        [PSCustomObject]@{File=[IO.Path]::GetFileName($file);Entries='-';Bytes=(Get-Item $file).Length;SHA256=(Get-FileHash $file -Algorithm SHA256).Hash}
    }
}
