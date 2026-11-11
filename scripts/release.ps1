$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$outputRoot = Join-Path $projectRoot 'dist'
$appDirectory = Join-Path $outputRoot 'SIMLINE-2.2-win32-x64'
if (-not (Test-Path -LiteralPath (Join-Path $appDirectory 'SIMLINE.exe'))) { throw 'Run npm run package first.' }
$version = (Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'package.json') | ConvertFrom-Json).version
$releaseRoot = Join-Path $outputRoot "GitHub-v$version"
$null = New-Item -Path $releaseRoot -ItemType Directory -Force
$applicationZip = Join-Path $releaseRoot "SIMLINE-$version-Windows-x64.zip"
$sourceZip = Join-Path $releaseRoot "SIMLINE-$version-source.zip"
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
    [IO.File]::Move($temp, $Destination, $true)
}
$runtimeEntries = foreach ($file in Get-ChildItem -LiteralPath $appDirectory -Recurse -File) {
    @{Path=$file.FullName;Name=('SIMLINE/' + [IO.Path]::GetRelativePath($appDirectory,$file.FullName).Replace('\','/'))}
}
Write-BundleArchive $applicationZip $runtimeEntries
$sourceEntries = foreach ($item in @('README.md','RELEASE.md','QA-START.cmd','QA-사용법.txt','사용안내.txt','검증결과.md','.gitignore','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','index.html','app.js','unified.js','families.js','family-ui.js','editor.js','editor.css','family.css','core.js','style.css','worker.js','main.cjs','preload.cjs','store.cjs','assets','scripts','tests')) {
    $path = Join-Path $projectRoot $item
    foreach ($file in Get-ChildItem -LiteralPath $path -Recurse -File) {
        @{Path=$file.FullName;Name=('SIMLINE-source/' + [IO.Path]::GetRelativePath($projectRoot,$file.FullName).Replace('\','/'))}
    }
}
Write-BundleArchive $sourceZip $sourceEntries
Copy-Item -LiteralPath (Join-Path $projectRoot 'RELEASE.md') -Destination (Join-Path $releaseRoot 'RELEASE.md') -Force
$checksums = foreach ($file in @($applicationZip,$sourceZip)) {
    (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + [IO.Path]::GetFileName($file)
}
[IO.File]::WriteAllLines((Join-Path $releaseRoot 'SHA256SUMS.txt'), $checksums)
foreach ($file in @($applicationZip,$sourceZip)) {
    $archive = [IO.Compression.ZipFile]::OpenRead($file)
    try {
        [PSCustomObject]@{File=[IO.Path]::GetFileName($file);Entries=$archive.Entries.Count;Bytes=(Get-Item $file).Length;SHA256=(Get-FileHash $file -Algorithm SHA256).Hash}
    } finally { $archive.Dispose() }
}
