param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$OutFile = ''
)

$ErrorActionPreference = 'Stop'
if (-not $OutFile) {
    $OutFile = Join-Path $ProjectRoot 'dist\SIMLINE_Sims4_Sync.ts4script'
}

$ts4Dir = 'C:\Program Files (x86)\Steam\steamapps\common\The Sims 4'
$pyDllDir = Join-Path $ts4Dir 'Game\Bin'
$baseZipLib = Join-Path $ts4Dir 'Data\Simulation\Gameplay\base.zip\lib'
if (-not (Test-Path (Join-Path $pyDllDir 'python37_x64.dll'))) {
    throw "Sims 4 python37_x64.dll not found at $pyDllDir"
}

$srcModDir = Join-Path $ProjectRoot 'sims4_mod\simline_sync'
$stageDir = Join-Path $ProjectRoot 'dist\.ts4build'
$stagePkg = Join-Path $stageDir 'simline_sync'
if (Test-Path $stageDir) { Remove-Item -Recurse -Force $stageDir }
New-Item -ItemType Directory -Path $stagePkg -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path -Parent $OutFile) -Force | Out-Null

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class SimlinePy37Compiler {
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool SetDllDirectory(string lpPathName);
    [DllImport("python37_x64.dll", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
    public static extern void Py_SetPath(string path);
    [DllImport("python37_x64.dll", CallingConvention = CallingConvention.Cdecl)]
    public static extern void Py_Initialize();
    [DllImport("python37_x64.dll", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    public static extern int PyRun_SimpleString(string command);
    [DllImport("python37_x64.dll", CallingConvention = CallingConvention.Cdecl)]
    public static extern void Py_Finalize();
}
"@

[SimlinePy37Compiler]::SetDllDirectory($pyDllDir) | Out-Null
[SimlinePy37Compiler]::Py_SetPath("$baseZipLib;$ts4Dir\Data\Simulation\Gameplay\base.zip")
[SimlinePy37Compiler]::Py_Initialize()

$srcEsc = $srcModDir.Replace('\', '\\')
$dstEsc = $stagePkg.Replace('\', '\\')
$outEsc = $OutFile.Replace('\', '\\')
$pyScript = @"
import os, py_compile, sys, zipfile

src_dir = r'$srcEsc'
dst_dir = r'$dstEsc'
out_zip = r'$outEsc'

compiled = []
for name in sorted(os.listdir(src_dir)):
    if not name.endswith('.py'):
        continue
    src_path = os.path.join(src_dir, name)
    pyc_name = name[:-3] + '.pyc'
    pyc_path = os.path.join(dst_dir, pyc_name)
    py_compile.compile(src_path, cfile=pyc_path, doraise=True)
    with open(pyc_path, 'rb') as f:
        magic = f.read(4)
    if magic != b'\x42\x0d\x0d\x0a':
        raise RuntimeError('Unexpected Python magic {} for {}'.format(magic.hex(), pyc_name))
    compiled.append((pyc_path, 'simline_sync/' + pyc_name))

if os.path.exists(out_zip):
    os.remove(out_zip)

with zipfile.ZipFile(out_zip, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
    for full_path, arc_name in compiled:
        zf.write(full_path, arc_name)

print('BUILT_TS4SCRIPT:', out_zip)
for _, arc_name in compiled:
    print('  ENTRY:', arc_name)
sys.stdout.flush()
"@

$rc = [SimlinePy37Compiler]::PyRun_SimpleString($pyScript)
[SimlinePy37Compiler]::Py_Finalize()
Remove-Item -Recurse -Force $stageDir -ErrorAction SilentlyContinue
if ($rc -ne 0) {
    throw "Python 3.7 compilation failed with exit code $rc"
}
if (-not (Test-Path $OutFile)) {
    throw "Expected ts4script output missing: $OutFile"
}
