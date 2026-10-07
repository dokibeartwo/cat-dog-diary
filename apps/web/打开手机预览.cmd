@echo off
cd /d "%~dp0"
if not exist ".preview-runtime\node.exe" (
  echo Local preview runtime is missing. Please ask to repair the preview launcher.
  pause
  exit /b 1
)
".preview-runtime\node.exe" "scripts\launch-preview.cjs"
pause
