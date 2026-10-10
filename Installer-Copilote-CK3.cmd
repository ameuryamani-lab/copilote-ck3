@echo off
rem CK3 Copilot installer: double-click this file. It runs installer.ps1 (same folder) with Windows PowerShell.
rem Safe to run again. It installs everything inside this folder, plus a "CK3 Copilot" shortcut on the desktop.
rem Installation du Copilote CK3 : double-clique sur ce fichier. Il lance installer.ps1 (meme dossier) avec Windows PowerShell.
rem Options (tests): -NoPrompt (no question), -NoShortcut (no desktop shortcut), -ShortcutDir "folder".
rem -ExecutionPolicy Bypass: by default Windows refuses to run .ps1 scripts you double-click; this option lifts that rule for this
rem   one PowerShell process only and changes no setting on the PC. -NoProfile: your PowerShell profile scripts are not loaded.
rem   PowerShell runs in this black window: nothing runs hidden.
rem -ExecutionPolicy Bypass : par defaut Windows refuse de lancer les scripts .ps1 par double-clic ; cette option le permet pour ce
rem   seul processus PowerShell et ne change aucun reglage du PC. -NoProfile : tes scripts de profil PowerShell ne sont pas charges.
rem   PowerShell tourne dans cette fenetre noire : rien ne tourne cache.
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
