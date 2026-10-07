@echo off
rem CK3 Copilot installer: double-click this file. It runs installer.ps1 (same folder) with Windows PowerShell.
rem Safe to run again. It installs everything inside this folder, plus a "CK3 Copilot" shortcut on the desktop.
rem Installation du Copilote CK3 : double-clique sur ce fichier. Il lance installer.ps1 (meme dossier) avec Windows PowerShell.
rem Options (tests): -NoPrompt (no question), -NoShortcut (no desktop shortcut), -ShortcutDir "folder".
setlocal
if not exist "%~dp0installer.ps1" (
  echo installer.ps1 not found: extract the whole ZIP first, then double-click this file in the extracted folder.
  echo installer.ps1 introuvable : extrais d'abord tout le ZIP, puis double-clique sur ce fichier dans le dossier extrait.
  pause
  exit /b 1
)
where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo Windows PowerShell not found: this installer needs Windows 10 or 11.
  echo Windows PowerShell introuvable : cette installation demande Windows 10 ou 11.
  pause
  exit /b 1
)
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer.ps1" %*
set "CODE=%ERRORLEVEL%"
endlocal & exit /b %CODE%
