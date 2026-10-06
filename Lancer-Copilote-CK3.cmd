@echo off
rem Lance le Copilote CK3 : une petite icône micro au-dessus de Crusader Kings III (Ctrl+Maj+Espace ou clic pour poser une question).
rem Electron est une appli fenêtrée : cette console se referme aussitôt. Double-cliquer deux fois ne crée pas de deuxième copie (instance unique).
setlocal
set "APPLI=%~dp0."
set "ELECTRON=%APPLI%\node_modules\electron\dist\electron.exe"
rem Si cette variable traîne dans l'environnement, Electron se prendrait pour Node et ne montrerait rien.
set "ELECTRON_RUN_AS_NODE="
if not exist "%ELECTRON%" (
  echo Electron not found / Electron introuvable : "%ELECTRON%"
  echo Install it first in this folder: npm install, then node node_modules\electron\install.js
  echo Installe-le d'abord dans ce dossier : npm install, puis node node_modules\electron\install.js
  pause
  exit /b 1
)
cd /d "%APPLI%"
start "" "%ELECTRON%" "%APPLI%"
endlocal
exit /b 0
