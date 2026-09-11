param(
    [string]$ProjectMRoot = "C:\projects\projectm",
    [string]$EmsdkRoot = "C:\projects\emsdk"
)
$ErrorActionPreference = "Stop"
$projectMPin = "149bfc43963e54e397ccdb42f27019d22b659098"
$actualPin = git -C $ProjectMRoot rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $actualPin -ne $projectMPin) { throw "Expected projectM $projectMPin" }
$env:EMSDK_QUIET = "1"
. (Join-Path $EmsdkRoot "emsdk_env.ps1")
$projectMBuild = Join-Path $ProjectMRoot "build-wasm"
$webRoot = Split-Path $PSScriptRoot
$projectMOutput = Join-Path $webRoot "app/public/projectm/projectm.js"
$compiler = Join-Path $EmsdkRoot "upstream/emscripten/em++.exe"
if (!(Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $EmsdkRoot "upstream/emscripten/em++.bat" }
& $compiler (Join-Path $PSScriptRoot "projectm-wrapper.cpp") `
  "$projectMBuild/src/libprojectM/libprojectM-4.a" `
  "$projectMBuild/src/playlist/libprojectM-4-playlist.a" `
  "$projectMBuild/vendor/projectm-eval/projectm-eval/libprojectM_eval.a" `
  "$projectMBuild/vendor/glad/libglad.a" `
  -I "$ProjectMRoot/src/api/include" -I "$projectMBuild/src/api/include" `
  -O3 -fexceptions -s USE_SDL=2 `
  -s MIN_WEBGL_VERSION=2 -s MAX_WEBGL_VERSION=2 -s FULL_ES2=1 -s FULL_ES3=1 `
  -s ALLOW_MEMORY_GROWTH=0 -s INITIAL_MEMORY=805306368 `
  -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME=createProjectM `
  -s "ENVIRONMENT=web,worker" `
  -s "EXPORTED_FUNCTIONS=['_main','_sv_init','_sv_resize','_sv_load_preset_data','_sv_last_error','_sv_add_pcm_float','_sv_max_samples','_sv_render','_sv_destroy','_malloc','_free']" `
  -s "EXPORTED_RUNTIME_METHODS=['ccall','cwrap','HEAPF32']" `
  -o $projectMOutput
if ($LASTEXITCODE -ne 0) { throw "projectM WASM link failed" }
