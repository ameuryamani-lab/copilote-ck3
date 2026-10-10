# CK3 Copilot installer, started by Installer-Copilote-CK3.cmd (double-click). Safe to run again: it only does what is missing.
#   1. checks Windows and this folder;
#   2. checks Node.js 22.12 or newer (only needed to install); if missing, offers to open https://nodejs.org/ in the browser
#      (it never downloads or installs Node.js itself);
#   3. installs the packages of package-lock.json (npm ci from registry.npmjs.org, integrity checked; fallback: npm install
#      --ignore-scripts, announced), then downloads Electron, the app's engine (about 150 MB, github.com, checksums checked by its install.js);
#   4. creates .env from .env.example and asks for the Google Gemini key (typed hidden, never shown, kept only in .env);
#   5. creates a "CK3 Copilot" shortcut on the desktop and checks (read only) that Windows lets desktop apps use the microphone.
# Nothing else is changed on the PC. Options (tests, automation): -NoPrompt (asks nothing, never opens the browser),
# -NoShortcut, -ShortcutDir <folder> (shortcut somewhere else than the desktop).
#
# Installation du Copilote CK3, lancée par Installer-Copilote-CK3.cmd (double-clic). On peut la relancer sans risque : elle ne fait
# que ce qui manque. Messages en anglais puis en français. Ce fichier est en UTF-8 avec BOM : sans BOM, Windows PowerShell 5.1 le
# lirait en ANSI et les accents des messages seraient abîmés.
param(
  [switch]$NoPrompt,
  [switch]$NoShortcut,
  [string]$ShortcutDir = ''
)
$ErrorActionPreference = 'Stop'
$App = $PSScriptRoot
$Electron = Join-Path $App 'node_modules\electron\dist\electron.exe'
$Utf8 = New-Object System.Text.UTF8Encoding $false
try { $Host.UI.RawUI.WindowTitle = 'CK3 Copilot - Installer / Installation' } catch { }

# ---------- Messages : anglais d'abord, puis français ----------
function Etape([int]$n, [string]$en, [string]$fr) {
  Write-Host ''
  Write-Host "[$n/5] $en" -ForegroundColor Cyan
  Write-Host "      $fr" -ForegroundColor DarkCyan
}
function Info([string]$en, [string]$fr) { Write-Host $en -ForegroundColor White; if ($fr) { Write-Host $fr -ForegroundColor Gray } }
function Bien([string]$en, [string]$fr) { Write-Host $en -ForegroundColor Green; if ($fr) { Write-Host $fr -ForegroundColor Green } }
function Attention([string]$en, [string]$fr) { Write-Host $en -ForegroundColor Yellow; if ($fr) { Write-Host $fr -ForegroundColor Yellow } }
function Fin([int]$code) {
  Write-Host ''
  if (-not $NoPrompt) { [void](Read-Host 'Press Enter to close / Appuie sur Entrée pour fermer') }
  exit $code
}
function Echec([string]$en, [string]$fr) {
  Write-Host ''
  Write-Host $en -ForegroundColor Red
  if ($fr) { Write-Host $fr -ForegroundColor Red }
  Fin 1
}
# Question oui / non ; avec -NoPrompt, la réponse est toujours non (rien n'est ouvert, rien n'est demandé).
function Demander([string]$en, [string]$fr, [bool]$defaut) {
  if ($NoPrompt) { return $false }
  Write-Host $en -ForegroundColor White
  Write-Host $fr -ForegroundColor Gray
  $choix = '[y/N] (o/N)'
  if ($defaut) { $choix = '[Y/n] (O/n)' }
  $r = "$(Read-Host $choix)".Trim().ToLower()
  if (-not $r) { return $defaut }
  return ($r -in @('y', 'yes', 'o', 'oui'))
}

# ---------- Outils ----------
function Trouver-Node {
  $c = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { return $c.Source }
  # Node.js installé à l'instant : la fenêtre ouverte avant l'installation n'a pas encore le nouveau PATH.
  foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) {
    if ($p -and (Test-Path -LiteralPath $p)) { return $p }
  }
  return $null
}
function Lire-Json([string]$f) {
  try { return ([IO.File]::ReadAllText($f, $Utf8) | ConvertFrom-Json) } catch { return $null }
}
# 'ok' : Electron prêt ; 'paquet' : le paquet npm est là mais pas le moteur ; 'absent' : npm ci à faire.
function Etat-Electron([string]$voulue) {
  $p = Lire-Json (Join-Path $App 'node_modules\electron\package.json')
  if (-not $p -or "$($p.version)" -ne $voulue) { return 'absent' }
  $v = ''
  try { $v = [IO.File]::ReadAllText((Join-Path $App 'node_modules\electron\dist\version')).Trim().TrimStart('v') } catch { }
  if ($v -eq $voulue -and (Test-Path -LiteralPath $Electron)) { return 'ok' }
  return 'paquet'
}
# Contrôle de la clé auprès de Google (liste des modèles : gratuit). La clé part dans l'en-tête x-goog-api-key, jamais dans l'adresse.
function Tester-Cle([string]$cle) {
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $null = Invoke-RestMethod -Uri 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1' -Headers @{'x-goog-api-key' = $cle} -TimeoutSec 20 -UseBasicParsing
    return 'ok'
  } catch {
    $code = 0
    try { $code = [int]$_.Exception.Response.StatusCode } catch { }
    if ($code -eq 400 -or $code -eq 401 -or $code -eq 403) { return 'refusee' }
    return 'inconnu'
  }
}
# Clé du fichier .env (ligne GEMINI_API_KEY=…, lue comme le fait serveur.mjs) : '' si absente ou vide.
function Lire-Cle([string]$fichierEnv) {
  try { $texte = [IO.File]::ReadAllText($fichierEnv, $Utf8) } catch { return '' }
  $m = [regex]::Match($texte, '(?m)^[ \t]*GEMINI_API_KEY[ \t]*=([^\r\n]*)')
  if (-not $m.Success) { return '' }
  $v = $m.Groups[1].Value.Trim().Trim('"', "'").Trim()
  if ($v.StartsWith('#')) { return '' }
  return $v
}
# Clé collée : espaces, guillemets ou ligne entière « GEMINI_API_KEY=… » retirés.
function Nettoyer-Cle([string]$brute) {
  $cle = "$brute".Trim().Trim('"', "'").Trim()
  if ($cle -match '^GEMINI_API_KEY\s*=\s*(.*)$') { $cle = $Matches[1].Trim().Trim('"', "'").Trim() }
  return $cle
}
# Contrôle de forme minimal : il ne repère qu'une saisie manifestement fausse (phrase avec espaces, texte trop court, accents ou
# caractères invisibles), tout le reste part au contrôle de Google. Les anciennes clés commencent par AIza ; depuis le 28/05/2026,
# AI Studio crée des « auth keys » dont la forme n'est pas documentée : on ne suppose rien d'autre (ASCII visible, 20 à 512 signes).
function Cle-Plausible([string]$cle) { return ($cle -cmatch '^[\x21-\x7E]{20,512}$') }
# Écrit la clé sur la ligne GEMINI_API_KEY= (ajoutée si absente), sans toucher aux autres lignes ni à leurs fins de ligne.
function Ecrire-Cle([string]$fichierEnv, [string]$cle) {
  $texte = ''
  if (Test-Path -LiteralPath $fichierEnv) { $texte = [IO.File]::ReadAllText($fichierEnv, $Utf8) }
  $nouvelle = "GEMINI_API_KEY=$cle"
  $m = [regex]::Match($texte, '(?m)^[ \t]*GEMINI_API_KEY[ \t]*=([^\r\n]*)')
  if ($m.Success) { $texte = $texte.Substring(0, $m.Index) + $nouvelle + $texte.Substring($m.Index + $m.Length) }
  else {
    $saut = "`n"
    if ($texte.Contains("`r`n") -or -not $texte) { $saut = "`r`n" }
    if ($texte) { $texte = $texte.TrimEnd("`r", "`n") + $saut }
    $texte = $texte + $nouvelle + $saut
  }
  [IO.File]::WriteAllText($fichierEnv, $texte, $Utf8)
}
# Micro coupé par Windows pour tout le PC, pour l'utilisateur ou pour les applis de bureau (lecture seule du registre).
function Micro-Bloque {
  $base = 'Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone'
  foreach ($c in @("HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone", "HKCU:\$base", "HKCU:\$base\NonPackaged")) {
    try { if ((Get-ItemProperty -LiteralPath $c -Name Value -ErrorAction Stop).Value -eq 'Deny') { return $true } } catch { }
  }
  return $false
}

try {
  Write-Host ''
  Write-Host 'CK3 Copilot - installation' -ForegroundColor Cyan
  Write-Host 'Copilote CK3 - installation' -ForegroundColor DarkCyan
  Write-Host "Folder / Dossier : $App" -ForegroundColor Gray

  # ---------- 1. Windows et dossier ----------
  Etape 1 'Checking Windows and this folder' 'Vérification de Windows et de ce dossier'
  $v = [Environment]::OSVersion.Version
  if ($v.Major -lt 10) { Echec "The copilot needs Windows 10 or 11 (this PC: Windows $v)." "Le copilote demande Windows 10 ou 11 (ce PC : Windows $v)." }
  if (-not [Environment]::Is64BitOperatingSystem) { Echec 'The copilot needs 64-bit Windows.' 'Le copilote demande Windows 64 bits.' }
  $manquants = @('main.mjs', 'package.json', 'aide-windows.ps1', 'page\index.html', 'agent\copilote-jeu.mjs') | Where-Object { -not (Test-Path -LiteralPath (Join-Path $App $_)) }
  if ($manquants) {
    # Double-clic dans le ZIP sans l'extraire : Windows copie ce seul fichier dans un dossier temporaire.
    if ($App -match '\\Temp\d*_[^\\]*\.zip(\\|$)' -or ($env:TEMP -and $App.StartsWith($env:TEMP, [StringComparison]::OrdinalIgnoreCase))) {
      Echec 'You opened the installer from inside the ZIP file. Right-click the ZIP > "Extract All...", open the extracted folder, then double-click Installer-Copilote-CK3.cmd there.' `
            'Tu as ouvert l''installation depuis l''intérieur du ZIP. Clic droit sur le ZIP > "Extraire tout...", ouvre le dossier extrait, puis double-clique sur Installer-Copilote-CK3.cmd dans ce dossier.'
    }
    Echec "This folder is incomplete (missing: $($manquants -join ', ')). Download the ZIP again from GitHub and extract all of it." `
          "Ce dossier est incomplet (manque : $($manquants -join ', ')). Retélécharge le ZIP sur GitHub et extrais-le en entier."
  }
  # Program Files : Windows n'y laisse écrire que les administrateurs (npm, .env, journal) : l'installation y échouerait (revue du 10/10/2026).
  foreach ($pf in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if ($pf -and $App.StartsWith($pf.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
      Echec "This folder is under Program Files, where Windows only lets administrators write: the installation would fail. Move the copilot's folder into your user folder (for example $env:USERPROFILE\CK3-Copilot), then run the installer again." `
            "Ce dossier est sous Program Files, où Windows ne laisse écrire que les administrateurs : l'installation échouerait. Déplace le dossier du copilote dans ton dossier utilisateur (par exemple $env:USERPROFILE\CK3-Copilot), puis relance l'installation."
    }
  }
  $nomWindows = 'Windows 10'
  if ($v.Build -ge 22000) { $nomWindows = 'Windows 11' }   # Windows 11 se déclare encore en version 10.0
  Bien "$nomWindows (build $($v.Build)), 64-bit: OK." "$nomWindows (build $($v.Build)), 64 bits : OK."

  # ---------- 2. Node.js ----------
  Etape 2 'Checking Node.js (only needed to install)' 'Vérification de Node.js (utile seulement pour installer)'
  $node = Trouver-Node
  $version = $null
  if ($node) { try { $version = "$(& $node -p 'process.versions.node' | Select-Object -First 1)".Trim() } catch { $version = $null } }
  $assez = $false
  if ($version -match '^(\d+)\.(\d+)') { $assez = ([int]$Matches[1] -gt 22) -or ([int]$Matches[1] -eq 22 -and [int]$Matches[2] -ge 12) }
  if (-not $assez) {
    if ($version) { Attention "Node.js $version is too old: version 22.12 or newer is needed." "Node.js $version est trop ancien : il faut la version 22.12 ou plus récente." }
    else { Attention 'Node.js is not installed on this PC.' 'Node.js n''est pas installé sur ce PC.' }
    Info 'Node.js is free. It is only used now, to install the copilot; the copilot itself does not need it.' 'Node.js est gratuit. Il ne sert que maintenant, pour installer le copilote ; le copilote lui-même n''en a pas besoin.'
    Info '  1. On nodejs.org, download the version marked "LTS" (Windows Installer, .msi).' '  1. Sur nodejs.org, télécharge la version marquée "LTS" (Windows Installer, .msi).'
    Info '  2. Install it with the default options.' '  2. Installe-la avec les options par défaut.'
    Info '  3. Double-click Installer-Copilote-CK3.cmd again.' '  3. Double-clique de nouveau sur Installer-Copilote-CK3.cmd.'
    if (Demander 'Open nodejs.org in your web browser now?' 'Ouvrir nodejs.org dans ton navigateur maintenant ?' $true) { Start-Process 'https://nodejs.org/' }
    Fin 1
  }
  $dossierNode = Split-Path -Parent $node
  $env:Path = "$dossierNode;$env:Path"
  $npm = Join-Path $dossierNode 'npm.cmd'
  if (-not (Test-Path -LiteralPath $npm)) {
    $c = Get-Command npm.cmd -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { $npm = $c.Source } else { Echec 'npm (installed with Node.js) is missing: reinstall Node.js from nodejs.org.' 'npm (installé avec Node.js) est introuvable : réinstalle Node.js depuis nodejs.org.' }
  }
  Bien "Node.js $version found." "Node.js $version trouvé."

  # ---------- 3. Paquets et Electron ----------
  Etape 3 'Installing the app engine (Electron)' 'Installation du moteur de l''appli (Electron)'
  $paquet = Lire-Json (Join-Path $App 'package.json')
  $voulue = "$($paquet.devDependencies.electron)".Trim()
  if (-not $voulue) { Echec 'package.json does not name an Electron version: download the ZIP again.' 'package.json ne donne pas de version d''Electron : retélécharge le ZIP.' }
  $etat = Etat-Electron $voulue
  if ($etat -eq 'ok') {
    Bien "Electron $voulue is already installed: nothing to download." "Electron $voulue est déjà installé : rien à télécharger."
  } else {
    # Le copilote lancé depuis ce dossier garde electron.exe ouvert : npm ne pourrait pas le remplacer.
    $lance = $false
    foreach ($p in @(Get-Process -Name electron -ErrorAction SilentlyContinue)) {
      try { if ($p.Path -and $p.Path.StartsWith($App + '\', [StringComparison]::OrdinalIgnoreCase)) { $lance = $true } } catch { }
    }
    if ($lance) { Echec 'The copilot is running from this folder. Quit it first (right-click its icon next to the clock > Quit), then run the installer again.' 'Le copilote tourne depuis ce dossier. Quitte-le d''abord (clic droit sur son icône près de l''horloge > Quitter), puis relance l''installation.' }
    Push-Location -LiteralPath $App
    try {
      if ($etat -eq 'absent') {
        Info 'Installing the packages (npm)... about one minute.' 'Installation des paquets (npm)... environ une minute.'
        $code = 1
        if (Test-Path -LiteralPath (Join-Path $App 'package-lock.json')) { & $npm ci --no-audit --no-fund; $code = $LASTEXITCODE }
        # Repli sans verrou (package-lock.json absent ou refusé) : versions choisies par npm, pas celles vérifiées ; --ignore-scripts
        # pour qu'aucun script d'un paquet non vérifié ne tourne (Electron est de toute façon téléchargé par install.js, plus bas).
        if ($code -ne 0) {
          Attention 'npm ci failed (package-lock.json missing or refused): switching to npm install WITHOUT the lock file. Package versions are then chosen by npm, not the ones checked by the author; no package script is run.' `
                    'npm ci a échoué (package-lock.json absent ou refusé) : passage à npm install SANS le fichier de verrou. Les versions des paquets sont alors choisies par npm, pas celles vérifiées par l''auteur ; aucun script de paquet n''est lancé.'
          & $npm install --no-audit --no-fund --ignore-scripts; $code = $LASTEXITCODE
        }
        if ($code -ne 0) { Echec 'npm could not install the packages. Check your Internet connection, then run the installer again.' 'npm n''a pas pu installer les paquets. Vérifie ta connexion Internet, puis relance l''installation.' }
      }
      Info 'Downloading Electron (about 150 MB): this can take a few minutes...' 'Téléchargement d''Electron (environ 150 Mo) : cela peut prendre quelques minutes...'
      # Depuis Electron 44, npm install ne télécharge plus le moteur : install.js le fait (depuis GitHub, avec contrôle des sommes).
      & $node (Join-Path $App 'node_modules\electron\install.js')
      $code = $LASTEXITCODE
    } finally { Pop-Location }
    if ($code -ne 0 -or (Etat-Electron $voulue) -ne 'ok') {
      Echec 'Electron could not be downloaded or unpacked. Check your Internet connection and run the installer again. If your antivirus blocked a file, see "Antivirus" in TUTORIAL.md.' `
            'Electron n''a pas pu être téléchargé ou décompressé. Vérifie ta connexion Internet et relance l''installation. Si ton antivirus a bloqué un fichier, vois "Antivirus" dans TUTORIAL.md.'
    }
    Bien "Electron $voulue installed." "Electron $voulue installé."
  }

  # ---------- 4. Clé Google Gemini dans .env ----------
  Etape 4 'Google Gemini key' 'Clé Google Gemini'
  $fichierEnv = Join-Path $App '.env'
  if (-not (Test-Path -LiteralPath $fichierEnv)) {
    $exemple = Join-Path $App '.env.example'
    if (Test-Path -LiteralPath $exemple) { Copy-Item -LiteralPath $exemple -Destination $fichierEnv }
    else { [IO.File]::WriteAllText($fichierEnv, "GEMINI_API_KEY=`r`nOPENAI_API_KEY=`r`n", $Utf8) }
    Info '.env created (your settings file, it stays on this PC).' '.env créé (ton fichier de réglages, il reste sur ce PC).'
  }
  $aCle = [bool](Lire-Cle $fichierEnv)
  if ($aCle) {
    Bien 'A Gemini key is already saved in .env: kept as it is.' 'Une clé Gemini est déjà enregistrée dans .env : elle est gardée telle quelle.'
  } elseif ($NoPrompt) {
    Attention 'No Gemini key yet (-NoPrompt): run the installer again to add it.' 'Pas encore de clé Gemini (-NoPrompt) : relance l''installation pour l''ajouter.'
  } else {
    Info 'Paste your Google Gemini key, then press Enter. To paste: Ctrl+V or right-click.' 'Colle ta clé Google Gemini, puis appuie sur Entrée. Pour coller : Ctrl+V ou clic droit.'
    Info 'The key shows as stars (*****): that is normal. It is saved only in the .env file of this folder.' 'La clé s''affiche en étoiles (*****) : c''est normal. Elle est enregistrée seulement dans le fichier .env de ce dossier.'
    Info 'No key yet? Just press Enter to skip: TUTORIAL.md explains how to get one.' 'Pas encore de clé ? Appuie simplement sur Entrée pour passer : TUTORIAL.md explique comment en obtenir une.'
    for ($essai = 1; $essai -le 3 -and -not $aCle; $essai++) {
      $secret = Read-Host 'Gemini key / Clé Gemini' -AsSecureString
      $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
      try { $cle = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
      $cle = Nettoyer-Cle $cle
      if (-not $cle) { Attention 'Skipped: no key saved.' 'Passé : aucune clé enregistrée.'; break }
      if (-not (Cle-Plausible $cle)) {
        Attention 'This does not look like a Gemini key (one long block of characters, without spaces). Try again, or press Enter to skip.' 'Cela ne ressemble pas à une clé Gemini (un long bloc de caractères, sans espace). Réessaie, ou appuie sur Entrée pour passer.'
        continue
      }
      Info 'Checking the key with Google...' 'Vérification de la clé auprès de Google...'
      $verdict = Tester-Cle $cle
      if ($verdict -eq 'refusee') {
        Attention 'Google refuses this key. Copy it again from aistudio.google.com/apikey (all of it), then paste it again, or press Enter to skip.' 'Google refuse cette clé. Recopie-la en entier depuis aistudio.google.com/apikey, puis colle-la de nouveau, ou appuie sur Entrée pour passer.'
        continue
      }
      if ($verdict -eq 'ok') { Bien 'Google accepts this key.' 'Google accepte cette clé.' }
      else { Attention 'Could not reach Google to check the key (no Internet?). It is saved anyway.' 'Impossible de joindre Google pour vérifier la clé (pas d''Internet ?). Elle est enregistrée quand même.' }
      Ecrire-Cle $fichierEnv $cle
      $cle = $null
      $aCle = $true
      Bien 'Key saved in .env (on this PC only).' 'Clé enregistrée dans .env (sur ce PC seulement).'
    }
  }

  # ---------- 5. Raccourci et micro ----------
  Etape 5 'Desktop shortcut and microphone' 'Raccourci sur le Bureau et micro'
  $raccourci = $false
  if ($NoShortcut) {
    Info 'Shortcut skipped (-NoShortcut).' 'Raccourci non créé (-NoShortcut).'
  } else {
    try {
      $dossier = $ShortcutDir
      if (-not $dossier) { $dossier = [Environment]::GetFolderPath('Desktop') }
      $lien = Join-Path $dossier 'CK3 Copilot.lnk'
      $existait = Test-Path -LiteralPath $lien
      $ws = New-Object -ComObject WScript.Shell
      $r = $ws.CreateShortcut($lien)
      # electron.exe directement (pas de console qui s'ouvre), avec le dossier de l'appli ; une seule copie tourne à la fois.
      $r.TargetPath = $Electron
      $r.Arguments = '"' + $App + '"'
      $r.WorkingDirectory = $App
      $r.IconLocation = "$Electron,0"
      $r.Description = 'CK3 Copilot: voice copilot for Crusader Kings III'
      $r.Save()
      $raccourci = $true
      if ($ShortcutDir) { Bien "Shortcut ""CK3 Copilot"" saved in $dossier." "Raccourci ""CK3 Copilot"" enregistré dans $dossier." }
      elseif ($existait) { Bien 'Desktop shortcut "CK3 Copilot" updated.' 'Raccourci "CK3 Copilot" mis à jour sur le Bureau.' }
      else { Bien 'Desktop shortcut "CK3 Copilot" created.' 'Raccourci "CK3 Copilot" créé sur le Bureau.' }
    } catch {
      Attention "No desktop shortcut ($($_.Exception.Message)). Start the copilot with Lancer-Copilote-CK3.cmd in this folder." "Pas de raccourci sur le Bureau ($($_.Exception.Message)). Lance le copilote avec Lancer-Copilote-CK3.cmd dans ce dossier."
    }
  }
  if (Micro-Bloque) {
    Attention 'Windows blocks the microphone for desktop apps. Settings > Privacy & security > Microphone: turn on "Microphone access" and "Let desktop apps access your microphone".' `
              'Windows bloque le micro pour les applis de bureau. Paramètres > Confidentialité et sécurité > Micro : active "Accès au micro" et "Autoriser les applications de bureau à accéder à votre micro".'
    if (Demander 'Open the microphone settings now?' 'Ouvrir les réglages du micro maintenant ?' $true) { Start-Process 'ms-settings:privacy-microphone' }
  } else {
    Bien 'Microphone: not blocked by Windows.' 'Micro : pas bloqué par Windows.'
  }

  # ---------- Suite ----------
  Write-Host ''
  Bien 'Installation finished!' 'Installation terminée !'
  Write-Host ''
  if (-not $aCle) { Attention 'Before playing: add your Gemini key. Double-click this installer again, it will ask for it.' 'Avant de jouer : ajoute ta clé Gemini. Double-clique de nouveau sur cette installation, elle te la demandera.' }
  Info 'Next:' 'Ensuite :'
  Info '  1. Start Crusader Kings III.' '  1. Lance Crusader Kings III.'
  if ($raccourci -and -not $ShortcutDir) { Info '  2. Double-click "CK3 Copilot" on your desktop (or Lancer-Copilote-CK3.cmd in this folder).' '  2. Double-clique sur "CK3 Copilot" sur ton Bureau (ou sur Lancer-Copilote-CK3.cmd dans ce dossier).' }
  else { Info '  2. Double-click Lancer-Copilote-CK3.cmd in this folder.' '  2. Double-clique sur Lancer-Copilote-CK3.cmd dans ce dossier.' }
  Info '  3. In the game, press Ctrl+Shift+Space (or click the microphone icon) and ask your question out loud.' '  3. Dans le jeu, appuie sur Ctrl+Maj+Espace (ou clique sur l''icône micro) et pose ta question à voix haute.'
  Info 'Step-by-step guide with pictures: TUTORIAL.md, on the GitHub page.' 'Guide pas à pas avec images : TUTORIAL.md, sur la page GitHub.'
  Fin 0
} catch {
  Echec "Unexpected error: $($_.Exception.Message)" "Erreur inattendue : $($_.Exception.Message)"
}
