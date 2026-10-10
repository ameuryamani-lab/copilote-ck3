# CK3 Copilot: step-by-step guide

This guide is for players, not developers. You will not need to type any command: you download a folder, double-click an installer, paste a key, and play.

*Version française : [plus bas](#version-française).*

<img src="docs/copilot-in-game-en.png" width="1100" alt="The CK3 Copilot answer panel next to the Tips window in Crusader Kings III">

*A real answer from the copilot for this game screen (CK3 1.20, English), with the panel shown moved to the right. By default it opens to the left of the game's main windows; you can drag it anywhere.*

**Contents:** [1. What you need](#1-what-you-need) · [2. Get a Google Gemini key](#2-get-a-google-gemini-key) · [3. Download the copilot](#3-download-the-copilot) · [4. Run the installer](#4-run-the-installer) · [5. Start CK3 and the copilot](#5-start-ck3-and-the-copilot) · [6. Your first question](#6-your-first-question) · [7. Show it things while you talk](#7-show-it-things-while-you-talk) · [8. Language, voice and other settings](#8-language-voice-and-other-settings) · [9. What it costs](#9-what-it-costs) · [10. Privacy](#10-privacy) · [11. Troubleshooting](#11-troubleshooting) · [12. Update](#12-update) · [13. Uninstall](#13-uninstall)

## 1. What you need

- A PC with **Windows 10 or 11** (64-bit) and a **microphone** (a headset works best).
- **Crusader Kings III** on Steam, with the game language set to **English** (in the game: **Settings**, **Language** section, choose English). The copilot quotes the game's buttons in English, so they must match your screen. It was tested with CK3 1.20, in Fullscreen mode at 1920 × 1080, on a single screen.
- A **Google account**. Google requires you to be 18 or older to use its Gemini API.
- An Internet connection, and about **600 MB** of free disk space.
- **Node.js**, a free program that is only used during installation. If you don't have it, the installer tells you how to get it.

## 2. Get a Google Gemini key

The copilot uses Google's AI (Gemini) to understand your question, look at the game and answer out loud. To use it, you need your own key: a long code that links the copilot to your Google account.

1. Go to **[aistudio.google.com/apikey](https://aistudio.google.com/apikey)** and sign in with your Google account.
2. The first time, accept the terms. Google then creates a project for you, and often a first key.
3. If no key is listed, click **Create API key**.
4. Copy the key (copy button next to it). Keep it somewhere safe for [section 4](#4-run-the-installer) (the installer), and treat it like a password: anyone who has it can spend your credit.
5. **Turn on billing (recommended).** Click **Set up billing** (in the **Billing Tier** column, on the **API keys** or **Projects** page), then choose your country and a payment method. New accounts usually prepay at least **$5**.

**Why billing is recommended.** Google also offers a free tier, but:

- On the free tier, Google says it may use what you send to improve its products, and human reviewers may read it. For the copilot, that means your spoken questions and the pictures of your game. (Google's terms say that in the European Economic Area, Switzerland and the UK, the paid-tier data rules apply even to free use.)
- The copilot asks Google Search to check facts with every answer, and Google lists Search as **not available on the free tier** for its Gemini 3 models. The copilot has not been tested with a free key: **it may not answer at all** ("Google is not responding" or "Google credit is used up"), even if the installer says "Google accepts this key" (that check only proves the key exists, not that it can use Search).
- The free tier has daily limits that a long game session can reach.

On the paid tier, Google does not use your prompts or answers to improve its products. A $5 prepayment is about 500 questions at today's prices (see [What it costs](#9-what-it-costs)).

**OpenAI key (optional).** If you also have an OpenAI key, the copilot uses it as a backup when Google refuses (no credit left, outage). You can add it later in the `.env` file (see [section 8](#8-language-voice-and-other-settings)).

## 3. Download the copilot

1. On the [copilot's GitHub page](https://github.com/ameuryamani-lab/copilote-ck3), click the green **Code** button, then **Download ZIP**.
2. Open your Downloads folder, **right-click** the ZIP file (`copilote-ck3-main.zip`), then **Extract All...**.
3. Choose a folder you will keep, inside your own user folder: for example `%USERPROFILE%\CK3-Copilot` (type it in the box, or click **Browse...**; to see your user folder, type `%USERPROFILE%` in the address bar of File Explorer), then click **Extract**. Why there: the copilot's folder will hold `.env`, the file with your key, and a folder shared by every account of the PC (such as `C:\Games`) would let the other Windows accounts read it. Avoid `Program Files` (the installation fails there without administrator rights, and the installer refuses it), the Downloads folder (easy to clean up by mistake) and folders synced by OneDrive (the copilot takes about 400 MB).
4. Windows puts a folder named **`copilote-ck3-main`** in the folder you chose, for example `%USERPROFILE%\CK3-Copilot\copilote-ck3-main`. **This is the copilot's folder:** everything this guide calls "the copilot's folder" is there.

Do not run anything from inside the ZIP: always extract it first.

## 4. Run the installer

Open the copilot's folder (`copilote-ck3-main`) and **double-click `Installer-Copilote-CK3.cmd`**. A black window opens; every message is shown in English, then in French.

> **Two files are called "installer".** Windows often hides the end of file names (`.cmd`, `.ps1`), so you may see `Installer-Copilote-CK3` (type "Windows Command Script") next to a file named just `installer`. Double-click **`Installer-Copilote-CK3`**. If Notepad (or a window asking which app to use) opens instead, you opened `installer`: close it and double-click the other one.

> **Windows may warn you,** because the file comes from the Internet and is not signed by a company:
> - "Windows protected your PC": click **More info**, then **Run anyway**.
> - "Open File - Security Warning": click **Run**.
>
> The installer is plain text: you can open `Installer-Copilote-CK3.cmd` and `installer.ps1` with Notepad and read what they do before you run them.
>
> If you read `Installer-Copilote-CK3.cmd`, you will see that it starts Windows PowerShell with `-ExecutionPolicy Bypass`: by default, Windows refuses to run `.ps1` scripts that you double-click, and this option lifts that rule for this one PowerShell process only; it changes no setting on your PC. PowerShell runs in the black window you see: nothing runs hidden.

The installer goes through 5 steps:

1. **Windows and folder.** It checks that you have Windows 10 or 11 and that the folder is complete.
2. **Node.js.** If Node.js is missing or too old, it explains what to do and offers to open [nodejs.org](https://nodejs.org/) in your browser. Download the version marked **LTS**, install it with the default options (you don't need "Tools for Native Modules"), then double-click the installer again. The installer never downloads or installs Node.js itself: you do it, from nodejs.org, in your browser.
3. **Electron.** It installs the app's engine, Electron (about 150 MB). This takes from a few seconds to a few minutes, depending on your connection. To be exact about what is downloaded and run: the 13 small packages listed in `package-lock.json` come from the official npm registry (registry.npmjs.org), and npm checks each one against the integrity fingerprint recorded in that file; Electron itself is downloaded by its own script (`install.js`, part of the `electron` package) from the official Electron releases on GitHub (github.com/electron/electron) and checked against the SHA-256 sums shipped in that package. These are programs from the Internet that run on your PC, like any installation: the installer limits them to these two official sources, downloads nothing from the author's own servers, and nodejs.org is only ever opened in your browser. If npm's first attempt (`npm ci`) fails and the installer says "npm ci failed (package-lock.json missing or refused): switching to npm install WITHOUT the lock file", the package versions are then the ones npm picks, not the ones checked by the author (no package script is run); you can also stop there and run the installer again later.
4. **Your Gemini key.** It asks you to paste your key: press **Ctrl+V** (or right-click), then **Enter**. The key shows as stars (`*****`): that is normal. The installer checks the key with Google, then saves it in a file named `.env`, in the copilot's folder, on your PC only. No key yet? Press Enter to skip, and run the installer again later.
5. **Shortcut and microphone.** It creates a **CK3 Copilot** shortcut on your desktop and checks that Windows lets desktop apps use the microphone.

It ends with "Installation finished!". Press Enter to close the window.

This is roughly what you should see. It is shortened: in the real window, each line is followed by its French version, and `...` marks a few lines left out here.

```
CK3 Copilot - installation
Folder / Dossier : <your user folder>\CK3-Copilot\copilote-ck3-main

[1/5] Checking Windows and this folder
Windows 11 (build 26200), 64-bit: OK.

[2/5] Checking Node.js (only needed to install)
Node.js 22.23.2 found.

[3/5] Installing the app engine (Electron)
Installing the packages (npm)... about one minute.
added 13 packages in 2s
Downloading Electron (about 150 MB): this can take a few minutes...
Electron 44.5.1 installed.

[4/5] Google Gemini key
.env created (your settings file, it stays on this PC).
Paste your Google Gemini key, then press Enter. To paste: Ctrl+V or right-click.
...
Gemini key / Clé Gemini: ***************************************
Checking the key with Google...
Google accepts this key.
Key saved in .env (on this PC only).

[5/5] Desktop shortcut and microphone
Desktop shortcut "CK3 Copilot" created.
Microphone: not blocked by Windows.

Installation finished!

Next:
  1. Start Crusader Kings III.
...
Press Enter to close / Appuie sur Entrée pour fermer:
```

Your version numbers may differ: that is fine.

You can run the installer again at any time: it only does what is missing, and keeps your key.

## 5. Start CK3 and the copilot

1. Start **Crusader Kings III** and load your game.
2. Double-click **CK3 Copilot** on your desktop (or `Lancer-Copilote-CK3.cmd` in the copilot's folder).
3. A round microphone icon appears on the right of the screen. It shows for 15 seconds even without the game, then only while CK3 is the window in front.

The copilot also puts a small icon next to the clock (it may be hidden behind the **^** arrow). Right-click it for the settings (see [section 8](#8-language-voice-and-other-settings)). You can drag the microphone icon anywhere.

## 6. Your first question

<img src="docs/icon-states.png" width="820" alt="The microphone icon in its five states: ready, listening, thinking, speaking, answer kept">

1. In the game, press **Ctrl+Shift+Space**, or click the microphone icon. The icon turns **red**: speak.
2. Ask your question out loud, for example "What should I do now?" or "How do I get a hook on this vassal?". When you stop talking, it stops listening by itself.
3. The panel opens and says what the copilot is doing ("Looking at your screen…", "Thinking…"), with a turning arc around the icon. A few seconds later, the answer appears and is read aloud.

**Walkie-talkie mode:** keep **Ctrl+Shift+Space** held down while you talk, and release the keys when you are done. (A quick press, shorter than about half a second, starts the normal mode instead.)

Answers are short: one sentence, then 2 to 4 steps that say where to click, 70 words at most. Button names are quoted in English, exactly as on screen. The copilot remembers the last 4 questions for 10 minutes, so you can follow up with "and then?".

The copilot never presses a key or clicks in the game: it only advises. The game does not pause by itself; press Space if you want to take your time.

<img src="docs/panel-en.png" width="488" alt="The answer panel with its buttons numbered 1 to 7">

1. **Replay the voice** (available as soon as the voice has started).
2. **Voice on / off.**
3. **New question.**
4. **Minimize:** the panel folds back into the icon and keeps the answer (blue dot). Click the icon to open it again, for example after opening the game window the answer talks about.
5. **Close.**
6. **The microphone icon.** While the copilot speaks, a click stops the voice.
7. **Status line:** how long the answer took and what it cost. Drag the panel by any empty spot to move it: it will stay there.

## 7. Show it things while you talk

The copilot does not only look at the screen when you press the keys. **During your whole question, it keeps watching the CK3 window** (a light look about once per second), then sends up to 4 views with your question, with close-ups around the mouse cursor to read the tooltip you are hovering.

So you can talk to it as you would to a friend sitting next to you: "Look at this county, is it worth taking?" while you hover the county, or open a window while you ask about it.

**Tip:** stop the mouse for half a second on what you want it to see. CK3 opens its tooltips when the mouse rests, and the copilot prefers the moments when the mouse was still.

Only the CK3 window is captured: never your desktop or other programs, and never windows on top of the game (including the copilot itself). One nuance: what another program draws *inside* the game's own image, such as the Steam overlay (Shift+Tab), is part of the CK3 window and is captured with it. The views stay in memory and are dropped after the question; only the main image of the last question is kept on disk (see [Privacy](#10-privacy)).

## 8. Language, voice and other settings

Right-click the copilot's icon next to the clock:

- **Voice on / Voice off:** answers read aloud or not (the panel button 2 does the same).
- **Forget the conversation:** the next question starts fresh.
- **Reset the icon and panel position.**
- **Reset the copilot (Ctrl+Shift+Backspace):** the same as the emergency shortcut: the icon and panel are rebuilt from scratch (listening and voice stopped, icon collapsed and shown for 8 seconds); your settings and the conversation are kept. Use it if the copilot stops reacting (see [Troubleshooting](#11-troubleshooting)).
- **Langue / Language:** Français or English. By default the copilot follows your Windows language. Changing the language also clears the conversation.
- **Quit (Ctrl+Shift+Backspace twice within 2 s).**

Four optional settings go in the `.env` file, in the copilot's folder. To edit it: right-click `.env` > **Open with** > **Notepad**, change the line, then **File > Save**.

- `OPENAI_API_KEY=`: paste an OpenAI key after the `=` sign if you want the backup.
- `COPILOTE_LANGUE=en` or `fr`: the answer language until you pick one in the menu.
- `COPILOTE_PRENOM=YourFirstName`: the copilot calls you by your first name (otherwise it talks to "the player"). Your first name is then sent to Google with each question.
- `COPILOTE_CK3_DIR=D:\SteamLibrary\steamapps\common\Crusader Kings III`: the game's folder, only if Steam is installed somewhere unusual and the copilot says it cannot find the game's Encyclopedia (see [Troubleshooting](#11-troubleshooting)).

In the file, the `COPILOTE_LANGUE`, `COPILOTE_PRENOM` and `COPILOTE_CK3_DIR` lines start with `#`, which switches them off. To use one, **delete the `#` and the space after it**, then write your value after the `=` sign. For example, `# COPILOTE_PRENOM=` becomes `COPILOTE_PRENOM=Alex`. Lines that start with `#` are only notes: the copilot ignores them.

Restart the copilot (menu > **Quit**, then the desktop shortcut) after changing `.env`.

## 9. What it costs

The copilot itself is free. You pay Google for what it uses, with your own key:

| | Per question | $5 of credit |
|---|---|---|
| Until 31 December 2026 (Google's promotional prices) | about 1 cent | about 500 questions |
| From 1 January 2027 (Google has announced it doubles these prices) | close to 2 cents | about 250 questions |

Two hours of play usually means $0.25 to $0.50 today. Google Search checks are free up to 5,000 per month. Each question is logged with its cost in the `journal\copilote-ck3` folder, and the panel shows the cost of each answer. You can follow your spending in Google AI Studio.

Prices checked on 7 October 2026; Google may change them.

## 10. Privacy

- **Microphone:** it opens only when you press the keys or click the icon, and the icon stays red while it listens. Your voice is not saved on your PC.
- **Screen:** only the CK3 window is captured, only during a question (40 seconds at most), and the views stay in memory.
- **What is sent, and to whom.** With each question, the copilot sends to Google (or to OpenAI if you added a backup key and Google fails):
  - the recording of your question (to be transcribed), then its transcript;
  - up to 4 views of the CK3 window with close-ups around the mouse cursor, with the position of the cursor in the window, the size of the window, the moment of each view during your question and whether the mouse was still;
  - the version of the game installed and the list of the expansions you own (and so which ones you lack), read from the game's files;
  - the excerpts of the game's Encyclopedia that match your question (texts from your game's files);
  - the last 4 exchanges of the past 10 minutes (your questions and the answers), so that "and then?" works;
  - your first name, if you set `COPILOTE_PRENOM`;
  - the copilot's own instructions (how to answer, reference notes about the game).

  While answering, Google may run Google searches of its own choosing (the sources appear under the answer). The text of the answer is then sent again to Google to be read aloud. Nothing is sent to the author of the copilot.
- **What stays on your PC**, in the copilot's folder:
  - `.env`: your key and settings;
  - `memoire\copilote-ck3\`: settings, icon position, a copy of the game's Encyclopedia texts, and `derniere-capture.jpg`, the main image of the last question (replaced at every question, kept to help with troubleshooting);
  - `journal\copilote-ck3\`: your questions, the answers and their cost, and the app's log, `app.log`.
- **Network:** the copilot's small local server only listens on your own PC (127.0.0.1): nobody on your network can reach it.
- **Google's free tier:** see [section 2](#2-get-a-google-gemini-key).

## 11. Troubleshooting

**The copilot is stuck over the game (nothing reacts, you can't move or close it).**
Press **Ctrl+Shift+Backspace** (the erase key above Enter): the copilot starts fresh (icon collapsed, listening and voice stopped). Press it **twice** within 2 seconds to close it completely; even if it froze, it is closed by force after 4 seconds. The game does not receive these keys. You can also right-click the icon or the panel: **Collapse**, **Reload**, **Quit the copilot**. The copilot also watches itself: if it stops responding for about 10 seconds, it collapses and restarts on its own. After 3 such restarts within 10 minutes, it stops trying: the icon stays collapsed and the tooltip of the copilot's icon next to the clock (hover it) reads "CK3 Copilot stopped: right-click here, “Reset the copilot”". Left-click that icon, or right-click it > **Reset the copilot**, or press Ctrl+Shift+Backspace in the game: the icon and panel are rebuilt. If that tooltip reads "CK3 Copilot · Ctrl+Shift+Backspace taken by another app: if stuck, right-click here" instead, another program took the emergency shortcut: the right-click menu remains the way out.

**The icon does not show over the game.**
The icon only shows while CK3 is the window in front. If you still don't see it, switch CK3 to window mode: press **Esc**, then **Settings** > **Graphics** > **Display Mode** > **Window**. Clicking the copilot's icon next to the clock also shows it for 15 seconds, and **Reset the icon and panel position** brings it back to its place.

**Ctrl+Shift+Space does nothing.**
The shortcut only works while CK3 is the window in front: click in the game first. Otherwise, click the microphone icon instead. If the status line says "Shortcut unavailable: click the icon", another program uses this shortcut. "(shortcut toggles only)" means the shortcut works, but not as a walkie-talkie.

**"The microphone is blocked".**
Open Windows **Settings > Privacy & security > Microphone**, and turn on **Microphone access** and **Let desktop apps access your microphone**. On Windows 10, similar switches are under **Settings > Privacy > Microphone**. For "No microphone found", plug in your headset. For "The microphone is not responding", check that no other program uses it, and that the right microphone is selected in **Settings > System > Sound > Input**.

**"Electron not found" when you start the copilot, or Windows says "Problem with Shortcut".**
The installation is not finished, or the copilot's folder was moved. Double-click `Installer-Copilote-CK3.cmd` again: it finishes the installation and recreates the desktop shortcut. If the black window also shows `npm` commands, ignore them: the installer does that for you. If a Windows box titled "The CK3 Copilot could not start" shows instead, read its "Cause" line: it says what failed, and names the file with the details, `journal\copilote-ck3\app.log` in the copilot's folder; attach that file if you report the problem.

**Windows refuses to open the installer.**
Right-click the ZIP file you downloaded > **Properties** > tick **Unblock** at the bottom > **OK**, then extract it again. If the installer says you opened it "from inside the ZIP", extract the ZIP first (see [section 3](#3-download-the-copilot)).

**Your antivirus warns about the copilot.**
The copilot has a small Windows helper, `aide-windows.ps1`, run by Windows PowerShell without a visible window (and, like the installer, with `-ExecutionPolicy Bypass`, see [section 4](#4-run-the-installer)): some antivirus programs flag any "hidden PowerShell" for that alone. It also does two things that antivirus programs watch closely:

- it captures the CK3 window (and only that window) to show it to the AI;
- it uses a **low-level keyboard hook**, the Windows feature that also lets programs see keys pressed in other windows. Keyloggers use it too, which is why some antivirus programs flag it. Here, the helper only reacts to two combinations, **Ctrl+Shift+Space** and **Ctrl+Shift+Backspace** (the emergency shortcut), and only while CK3 is in front: it holds back those two (otherwise CK3 would also see Space and pause or unpause the game), lets every other key through untouched, records nothing and sends nothing. It never sends keys or clicks. A hook is needed because Windows' normal shortcut system cannot tell when the keys are released (needed for the walkie-talkie mode) and would take the shortcut away from every other program.

The code is open: you can read `aide-windows.ps1`, or ask someone you trust to check it. If your antivirus moved a file to quarantine, you can restore it and allow the copilot's folder, or simply not use the copilot. Do not turn your antivirus off.

**No answer, or "No AI key found".**
These messages show in the answer panel. When Google fails, the copilot switches to OpenAI if you gave it an OpenAI key ("switching to OpenAI"); without one, the message ends with "and there is no OpenAI key to take over", and there is no answer.
- "No AI key found": the key is missing from `.env`. Run the installer again, it will ask for it.
- "Google credit is used up": add credit in Google AI Studio (Billing). The copilot then goes through OpenAI for 5 minutes before trying Google again.
- "Google daily quota reached": your key's quota for the day is used up (free tier). Wait for the next day, or set up billing (see [section 2](#2-get-a-google-gemini-key)). Same 5 minutes through OpenAI.
- "Google is rate-limiting (too many requests)" or "Google is overloaded": before showing this, the copilot already tried again once on its own, after the delay Google asked for (8 seconds at most). Ask your question again in a moment.
- "Google no longer knows the model": Google retired the model the copilot uses. Download the new version (see [section 12](#12-update)).
- "Google key refused": the key in `.env` is wrong, or was deleted in AI Studio. See "Wrong key saved, or a new key?" below.
- "Google is not responding": check your Internet connection, and check that your key still exists in AI Studio. On a free key, see [section 2](#2-get-a-google-gemini-key).

**Wrong key saved, or a new key?**
The installer keeps a key that is already saved and does not ask again. Open `.env` with Notepad (see [section 8](#8-language-voice-and-other-settings)), replace the text after `GEMINI_API_KEY=` with your new key (no space, no quotes), save, then restart the copilot.

**"Encyclopedia not found" in the answer panel.**
Shown once, with your first question; the copilot still answers ("Answering without it"), but it can no longer quote the exact texts of your version. It looks for CK3 where Steam installed it (Steam's folder, read from the Windows registry, and the libraries Steam declares), and the message names the Steam folders it looked in. If Steam or the game is somewhere unusual, open `.env` with Notepad (see [section 8](#8-language-voice-and-other-settings)) and give the game's folder on the `COPILOTE_CK3_DIR=` line, for example `COPILOTE_CK3_DIR=D:\SteamLibrary\steamapps\common\Crusader Kings III` (in Steam: right-click the game > **Manage** > **Browse local files** opens that folder), then restart the copilot. If the message says instead that `COPILOTE_CK3_DIR` is not the Crusader Kings III folder, the path is wrong: it must be the folder that contains `launcher\launcher-settings.json`.

**"CK3 isn't running" while the game is open.**
CK3 must be running and not minimized. Click in the game, then ask again.

**"Windows helper down: capture unavailable" in the status line.**
The copilot's small Windows helper, `aide-windows.ps1` (the PowerShell that captures the game and handles the shortcut), stopped or could not start: usually an antivirus, or a Windows setting that blocks PowerShell (see "Your antivirus warns about the copilot" above). The copilot restarts it by itself (after 1, 2 then 4 seconds, 3 times a minute at most), then tries again about a minute later and less and less often; until then it cannot look at the game. If it stays, quit the copilot (right-click its icon next to the clock > **Quit**) and start it again; the reason is in `journal\copilote-ck3\app.log`.

**The answer comes in the wrong language.**
Right-click the copilot's icon next to the clock > **Langue / Language**.

**A wrong answer?**
The copilot is in beta and can make mistakes. You can report it in the [Issues](https://github.com/ameuryamani-lab/copilote-ck3/issues) tab, with the question you asked.

## 12. Update

1. Quit the copilot (right-click its icon next to the clock > **Quit**).
2. Download the new ZIP and extract it **to the same place as the first time** (for example `%USERPROFILE%\CK3-Copilot`), so that it lands in the same `copilote-ck3-main` folder. When Windows asks, choose **Replace the files in the destination**. Your `.env`, settings and logs are not in the ZIP, so they are kept.
3. Double-click `Installer-Copilote-CK3.cmd` again: it updates Electron if needed.

## 13. Uninstall

1. Quit the copilot (right-click its icon next to the clock > **Quit**).
2. Delete the copilot's folder (`copilote-ck3-main`). This also deletes your key, settings and logs.
3. Delete the **CK3 Copilot** shortcut from your desktop.
4. Optional: delete the folders `%APPDATA%\copilote-ck3` (Electron's data for the copilot) and `%LOCALAPPDATA%\electron\Cache` (the Electron download, about 150 MB; other Electron-based programs you install yourself may use it too). Type these names in the File Explorer address bar to open them.
5. Optional: uninstall Node.js (**Settings > Apps**) if you don't use it for anything else, and delete your key in Google AI Studio if you won't use it anymore.

---

## Version française

Ce guide s'adresse aux joueurs, pas aux développeurs. Tu n'auras aucune commande à taper : tu télécharges un dossier, tu double-cliques sur une installation, tu colles une clé, et tu joues.

<img src="docs/copilot-in-game-fr.png" width="1100" alt="Le panneau de réponse du Copilote CK3 à côté de la fenêtre Tips de Crusader Kings III">

*Une vraie réponse du copilote pour cet écran de jeu (CK3 1.20, en anglais), avec le panneau montré déplacé à droite. Par défaut, il s'ouvre à gauche des fenêtres principales du jeu ; tu peux le faire glisser où tu veux.*

**Sommaire :** [1. Ce qu'il te faut](#1-ce-quil-te-faut) · [2. Obtenir une clé Google Gemini](#2-obtenir-une-clé-google-gemini) · [3. Télécharger le copilote](#3-télécharger-le-copilote) · [4. Lancer l'installation](#4-lancer-linstallation) · [5. Lancer CK3 et le copilote](#5-lancer-ck3-et-le-copilote) · [6. Ta première question](#6-ta-première-question) · [7. Lui montrer des choses en parlant](#7-lui-montrer-des-choses-en-parlant) · [8. Langue, voix et autres réglages](#8-langue-voix-et-autres-réglages) · [9. Ce que ça coûte](#9-ce-que-ça-coûte) · [10. Vie privée](#10-vie-privée) · [11. En cas de problème](#11-en-cas-de-problème) · [12. Mettre à jour](#12-mettre-à-jour) · [13. Désinstaller](#13-désinstaller)

### 1. Ce qu'il te faut

- Un PC sous **Windows 10 ou 11** (64 bits) et un **micro** (un casque micro, c'est le mieux).
- **Crusader Kings III** sur Steam, avec le jeu réglé en **anglais** (dans le jeu : **Paramètres**, rubrique **Langue**, choisis English). Le copilote cite les boutons du jeu en anglais : ils doivent correspondre à ton écran. Il a été essayé avec CK3 1.20, en mode « Fullscreen » à 1920 × 1080, sur un seul écran.
- Un **compte Google**. Google demande d'avoir 18 ans ou plus pour utiliser son API Gemini.
- Une connexion Internet et environ **600 Mo** d'espace libre.
- **Node.js**, un programme gratuit qui ne sert que pendant l'installation. Si tu ne l'as pas, l'installation t'explique comment l'obtenir.

### 2. Obtenir une clé Google Gemini

Le copilote utilise l'IA de Google (Gemini) pour comprendre ta question, regarder le jeu et te répondre à voix haute. Il te faut pour cela ta propre clé : un long code qui relie le copilote à ton compte Google.

1. Va sur **[aistudio.google.com/apikey](https://aistudio.google.com/apikey)** et connecte-toi avec ton compte Google.
2. La première fois, accepte les conditions. Google crée alors un projet pour toi, et souvent une première clé.
3. Si aucune clé n'apparaît, clique sur **Create API key**.
4. Copie la clé (bouton de copie à côté). Garde-la pour [la partie 4](#4-lancer-linstallation) (l'installation), et traite-la comme un mot de passe : quiconque l'a peut dépenser ton crédit.
5. **Active la facturation (conseillé).** Clique sur **Set up billing** (dans la colonne **Billing Tier**, sur la page **API keys** ou **Projects**), puis choisis ton pays et un moyen de paiement. Les nouveaux comptes paient en général d'avance au moins **5 $**.

**Pourquoi la facturation est conseillée.** Google propose aussi une offre gratuite, mais :

- Avec l'offre gratuite, Google dit pouvoir utiliser ce que tu envoies pour améliorer ses produits, et des personnes peuvent le relire. Pour le copilote, ce sont tes questions dites à voix haute et les images de ton jeu. (Les conditions de Google disent que dans l'Espace économique européen, en Suisse et au Royaume-Uni, les règles de l'offre payante s'appliquent même à l'usage gratuit.)
- Le copilote demande à la recherche Google de vérifier les faits à chaque réponse, et Google indique que la recherche **n'est pas disponible dans l'offre gratuite** pour ses modèles Gemini 3. Le copilote n'a pas été essayé avec une clé gratuite : **il peut ne plus répondre du tout** (« Google ne répond pas » ou « Crédit Google épuisé »), même si l'installation dit « Google accepte cette clé » (ce contrôle prouve seulement que la clé existe, pas qu'elle peut utiliser la recherche).
- L'offre gratuite a des limites par jour qu'une longue partie peut atteindre.

Avec l'offre payante, Google n'utilise ni tes demandes ni les réponses pour améliorer ses produits. 5 $ d'avance font environ 500 questions aux prix actuels (voir [Ce que ça coûte](#9-ce-que-ça-coûte)).

**Clé OpenAI (facultative).** Si tu as aussi une clé OpenAI, le copilote s'en sert de secours quand Google refuse (plus de crédit, panne). Tu pourras l'ajouter plus tard dans le fichier `.env` (voir [la partie 8](#8-langue-voix-et-autres-réglages)).

### 3. Télécharger le copilote

1. Sur la [page GitHub du copilote](https://github.com/ameuryamani-lab/copilote-ck3), clique sur le bouton vert **Code**, puis sur **Download ZIP**.
2. Ouvre ton dossier Téléchargements, fais un **clic droit** sur le fichier ZIP (`copilote-ck3-main.zip`), puis **Extraire tout...**.
3. Choisis un dossier que tu garderas, dans ton propre dossier utilisateur : par exemple `%USERPROFILE%\CK3-Copilot` (tape-le dans la case, ou clique sur **Parcourir...** ; pour voir ton dossier utilisateur, tape `%USERPROFILE%` dans la barre d'adresse de l'Explorateur de fichiers), puis clique sur **Extraire**. Pourquoi là : le dossier du copilote contiendra `.env`, le fichier avec ta clé, et un dossier commun à tous les comptes du PC (comme `C:\Jeux`) laisserait les autres comptes Windows le lire. Évite `Program Files` (l'installation y échoue sans droits d'administrateur, et l'installation le refuse), le dossier Téléchargements (facile à vider par erreur) et les dossiers synchronisés par OneDrive (le copilote prend environ 400 Mo).
4. Windows met un dossier nommé **`copilote-ck3-main`** dans le dossier choisi, par exemple `%USERPROFILE%\CK3-Copilot\copilote-ck3-main`. **C'est le dossier du copilote :** tout ce que ce guide appelle « le dossier du copilote » est là.

Ne lance rien depuis l'intérieur du ZIP : extrais-le toujours d'abord.

### 4. Lancer l'installation

Ouvre le dossier du copilote (`copilote-ck3-main`) et **double-clique sur `Installer-Copilote-CK3.cmd`**. Une fenêtre noire s'ouvre ; chaque message est écrit en anglais, puis en français.

> **Deux fichiers s'appellent « installer ».** Windows cache souvent la fin des noms de fichiers (`.cmd`, `.ps1`) : tu peux voir `Installer-Copilote-CK3` (type « Script de commande Windows ») à côté d'un fichier nommé seulement `installer`. Double-clique sur **`Installer-Copilote-CK3`**. Si le Bloc-notes (ou une fenêtre qui demande avec quelle appli ouvrir le fichier) s'ouvre, tu as ouvert `installer` : ferme-le et double-clique sur l'autre.

> **Windows peut t'avertir,** parce que le fichier vient d'Internet et n'est pas signé par une entreprise :
> - « Windows a protégé votre ordinateur » : clique sur **Informations complémentaires**, puis **Exécuter quand même**.
> - « Fichier ouvert - Avertissement de sécurité » : clique sur **Exécuter**.
>
> L'installation est du simple texte : tu peux ouvrir `Installer-Copilote-CK3.cmd` et `installer.ps1` avec le Bloc-notes et lire ce qu'ils font avant de les lancer.
>
> Si tu lis `Installer-Copilote-CK3.cmd`, tu verras qu'il lance Windows PowerShell avec `-ExecutionPolicy Bypass` : par défaut, Windows refuse de lancer les scripts `.ps1` sur lesquels on double-clique, et cette option lève cette règle pour ce seul processus PowerShell ; elle ne change aucun réglage de ton PC. PowerShell tourne dans la fenêtre noire que tu vois : rien ne tourne caché.

L'installation passe par 5 étapes :

1. **Windows et dossier.** Elle vérifie que tu as Windows 10 ou 11 et que le dossier est complet.
2. **Node.js.** S'il manque ou s'il est trop ancien, elle t'explique quoi faire et te propose d'ouvrir [nodejs.org](https://nodejs.org/) dans ton navigateur. Télécharge la version marquée **LTS**, installe-la avec les options par défaut (« Tools for Native Modules » est inutile), puis double-clique de nouveau sur l'installation. Elle ne télécharge ni n'installe jamais Node.js elle-même : c'est toi qui le fais, depuis nodejs.org, dans ton navigateur.
3. **Electron.** Elle installe le moteur de l'appli, Electron (environ 150 Mo). Cela prend de quelques secondes à quelques minutes selon ta connexion. Pour être exact sur ce qui est téléchargé et lancé : les 13 petits paquets listés dans `package-lock.json` viennent du registre officiel npm (registry.npmjs.org), et npm vérifie chacun avec l'empreinte d'intégrité notée dans ce fichier ; Electron lui-même est téléchargé par son propre script (`install.js`, fourni dans le paquet `electron`) depuis les versions officielles d'Electron sur GitHub (github.com/electron/electron) et vérifié avec les sommes SHA-256 fournies dans ce paquet. Ce sont des programmes venus d'Internet qui tournent sur ton PC, comme pour toute installation : l'installation les limite à ces deux sources officielles, ne télécharge rien depuis les serveurs de l'auteur, et nodejs.org n'est jamais qu'ouvert dans ton navigateur. Si le premier essai de npm (`npm ci`) échoue et que l'installation dit « npm ci a échoué (package-lock.json absent ou refusé) : passage à npm install SANS le fichier de verrou », les versions des paquets sont alors celles que npm choisit, pas celles vérifiées par l'auteur (aucun script de paquet n'est lancé) ; tu peux aussi t'arrêter là et relancer l'installation plus tard.
4. **Ta clé Gemini.** Elle te demande de coller ta clé : **Ctrl+V** (ou clic droit), puis **Entrée**. La clé s'affiche en étoiles (`*****`) : c'est normal. L'installation vérifie la clé auprès de Google, puis l'enregistre dans un fichier nommé `.env`, dans le dossier du copilote, sur ton PC seulement. Pas encore de clé ? Appuie sur Entrée pour passer, et relance l'installation plus tard.
5. **Raccourci et micro.** Elle crée un raccourci **CK3 Copilot** sur ton Bureau et vérifie que Windows laisse les applis de bureau utiliser le micro.

Elle se termine par « Installation terminée ! ». Appuie sur Entrée pour fermer la fenêtre.

Voici à peu près ce que tu dois voir. C'est raccourci : dans la vraie fenêtre, chaque ligne en français suit sa version anglaise, et `...` marque quelques lignes omises ici.

```
Copilote CK3 - installation
Folder / Dossier : <your user folder>\CK3-Copilot\copilote-ck3-main

[1/5] Vérification de Windows et de ce dossier
Windows 11 (build 26200), 64 bits : OK.

[2/5] Vérification de Node.js (utile seulement pour installer)
Node.js 22.23.2 trouvé.

[3/5] Installation du moteur de l'appli (Electron)
Installation des paquets (npm)... environ une minute.
added 13 packages in 2s
Téléchargement d'Electron (environ 150 Mo) : cela peut prendre quelques minutes...
Electron 44.5.1 installé.

[4/5] Clé Google Gemini
.env créé (ton fichier de réglages, il reste sur ce PC).
Colle ta clé Google Gemini, puis appuie sur Entrée. Pour coller : Ctrl+V ou clic droit.
...
Gemini key / Clé Gemini: ***************************************
Vérification de la clé auprès de Google...
Google accepte cette clé.
Clé enregistrée dans .env (sur ce PC seulement).

[5/5] Raccourci sur le Bureau et micro
Raccourci "CK3 Copilot" créé sur le Bureau.
Micro : pas bloqué par Windows.

Installation terminée !

Ensuite :
  1. Lance Crusader Kings III.
...
Press Enter to close / Appuie sur Entrée pour fermer:
```

Tes numéros de version peuvent être différents : ce n'est pas grave.

Tu peux relancer l'installation quand tu veux : elle ne fait que ce qui manque, et garde ta clé.

### 5. Lancer CK3 et le copilote

1. Lance **Crusader Kings III** et charge ta partie.
2. Double-clique sur **CK3 Copilot** sur ton Bureau (ou sur `Lancer-Copilote-CK3.cmd` dans le dossier du copilote).
3. Une icône ronde avec un micro apparaît à droite de l'écran. Elle reste 15 secondes même sans le jeu, puis seulement quand CK3 est la fenêtre au premier plan.

Le copilote met aussi une petite icône près de l'horloge (elle peut être cachée derrière la flèche **^**). Fais un clic droit dessus pour les réglages (voir [la partie 8](#8-langue-voix-et-autres-réglages)). Tu peux faire glisser l'icône micro où tu veux.

### 6. Ta première question

<img src="docs/icon-states.png" width="820" alt="L'icône micro dans ses cinq états : prêt, écoute, réflexion, parle, réponse gardée">

1. Dans le jeu, appuie sur **Ctrl+Maj+Espace**, ou clique sur l'icône micro. L'icône devient **rouge** : parle.
2. Pose ta question à voix haute, par exemple « Qu'est-ce que je dois faire maintenant ? » ou « Comment obtenir un moyen de pression sur ce vassal ? ». Quand tu te tais, il arrête d'écouter tout seul.
3. Le panneau s'ouvre et dit ce que fait le copilote (« Je regarde ton écran… », « Je réfléchis… »), avec un arc qui tourne autour de l'icône. Quelques secondes plus tard, la réponse s'affiche et il la lit à voix haute.

**Mode talkie-walkie :** garde **Ctrl+Maj+Espace** enfoncé pendant que tu parles, et lâche les touches quand tu as fini. (Un appui bref, de moins d'une demi-seconde environ, lance plutôt le mode normal.)

Les réponses sont courtes : une phrase, puis 2 à 4 étapes qui disent où cliquer, 70 mots au plus. Les noms des boutons sont donnés en anglais, exactement comme à l'écran. Le copilote se souvient des 4 dernières questions pendant 10 minutes : tu peux enchaîner avec « et ensuite ? ».

Le copilote n'appuie jamais sur une touche et ne clique jamais dans le jeu : il conseille seulement. Le jeu ne se met pas en pause tout seul ; appuie sur Espace si tu veux prendre ton temps.

<img src="docs/panel-fr.png" width="488" alt="Le panneau de réponse avec ses boutons numérotés de 1 à 7">

1. **Répéter la voix** (disponible dès que la voix a commencé).
2. **Voix activée / coupée.**
3. **Nouvelle question.**
4. **Réduire :** le panneau se replie dans l'icône en gardant la réponse (point bleu). Clique sur l'icône pour la rouvrir, par exemple après avoir ouvert la fenêtre du jeu dont parle la réponse.
5. **Fermer.**
6. **L'icône micro.** Pendant que le copilote parle, un clic coupe la voix.
7. **Ligne d'état :** le temps de la réponse et son coût. Fais glisser le panneau par n'importe quel endroit vide pour le déplacer : il restera là.

### 7. Lui montrer des choses en parlant

Le copilote ne regarde pas l'écran seulement au moment où tu appuies. **Pendant toute ta question, il continue de regarder la fenêtre de CK3** (un coup d'œil léger environ une fois par seconde), puis envoie jusqu'à 4 vues avec ta question, avec des zooms autour du curseur de la souris pour lire l'info-bulle que tu survoles.

Tu peux donc lui parler comme à un ami assis à côté de toi : « Regarde ce comté, ça vaut le coup de le prendre ? » en survolant le comté, ou ouvrir une fenêtre pendant que tu poses ta question.

**Astuce :** arrête la souris une demi-seconde sur ce que tu veux qu'il voie. CK3 ouvre ses info-bulles quand la souris s'arrête, et le copilote préfère les moments où la souris était immobile.

Seule la fenêtre de CK3 est capturée : jamais ton Bureau ni tes autres programmes, et jamais les fenêtres posées sur le jeu (le copilote compris). Une nuance : ce qu'un autre programme dessine *dans* l'image même du jeu, comme l'overlay Steam (Maj+Tab), fait partie de la fenêtre de CK3 et est capturé avec elle. Les vues restent en mémoire et sont oubliées après la question ; seule l'image principale de la dernière question est gardée sur le disque (voir [Vie privée](#10-vie-privée)).

### 8. Langue, voix et autres réglages

Fais un clic droit sur l'icône du copilote près de l'horloge :

- **Voix activée / Voix désactivée :** réponses lues à voix haute ou non (le bouton 2 du panneau fait la même chose).
- **Oublier la conversation :** la question suivante repart de zéro.
- **Replacer l'icône et le panneau.**
- **Réinitialiser le copilote (Ctrl+Maj+Retour arrière) :** la même chose que le raccourci d'urgence : l'icône et le panneau sont refaits à neuf (écoute et voix coupées, icône repliée et montrée 8 secondes) ; tes réglages et la conversation sont gardés. À utiliser si le copilote ne réagit plus (voir [En cas de problème](#11-en-cas-de-problème)).
- **Langue / Language :** Français ou English. Par défaut, le copilote suit la langue de Windows. Changer de langue efface aussi la conversation.
- **Quitter (Ctrl+Maj+Retour arrière deux fois en moins de 2 s).**

Quatre réglages facultatifs se mettent dans le fichier `.env`, dans le dossier du copilote. Pour le modifier : clic droit sur `.env` > **Ouvrir avec** > **Bloc-notes**, change la ligne, puis **Fichier > Enregistrer**.

- `OPENAI_API_KEY=` : colle une clé OpenAI après le signe `=` si tu veux le secours.
- `COPILOTE_LANGUE=fr` ou `en` : la langue des réponses tant que tu n'en as pas choisi une dans le menu.
- `COPILOTE_PRENOM=TonPrénom` : le copilote t'appelle par ton prénom (sinon il parle « au joueur »). Ton prénom part alors chez Google avec chaque question.
- `COPILOTE_CK3_DIR=D:\SteamLibrary\steamapps\common\Crusader Kings III` : le dossier du jeu, seulement si Steam est installé à un endroit inhabituel et que le copilote dit ne pas trouver l'Encyclopédie du jeu (voir [En cas de problème](#11-en-cas-de-problème)).

Dans le fichier, les lignes `COPILOTE_LANGUE`, `COPILOTE_PRENOM` et `COPILOTE_CK3_DIR` commencent par `#`, ce qui les désactive. Pour en utiliser une, **efface le `#` et l'espace qui le suit**, puis écris ta valeur après le signe `=`. Par exemple, `# COPILOTE_PRENOM=` devient `COPILOTE_PRENOM=Alex`. Les lignes qui commencent par `#` ne sont que des notes : le copilote les ignore.

Relance le copilote (menu > **Quitter**, puis le raccourci du Bureau) après avoir modifié `.env`.

### 9. Ce que ça coûte

Le copilote lui-même est gratuit. Tu paies à Google ce qu'il utilise, avec ta propre clé :

| | Par question | 5 $ de crédit |
|---|---|---|
| Jusqu'au 31 décembre 2026 (prix promotionnels de Google) | environ 1 cent | environ 500 questions |
| À partir du 1er janvier 2027 (Google a annoncé qu'il double ces prix) | près de 2 cents | environ 250 questions |

Deux heures de jeu coûtent en général de 0,25 à 0,50 $ aujourd'hui. Les vérifications par la recherche Google sont gratuites jusqu'à 5 000 par mois. Chaque question est notée avec son coût dans le dossier `journal\copilote-ck3`, et le panneau affiche le coût de chaque réponse. Tu peux suivre tes dépenses dans Google AI Studio.

Prix vérifiés le 7 octobre 2026 ; Google peut les changer.

### 10. Vie privée

- **Micro :** il ne s'ouvre que quand tu appuies sur les touches ou cliques sur l'icône, et l'icône reste rouge pendant qu'il écoute. Ta voix n'est pas enregistrée sur ton PC.
- **Écran :** seule la fenêtre de CK3 est capturée, seulement pendant une question (40 secondes au plus), et les vues restent en mémoire.
- **Ce qui part, et chez qui.** À chaque question, le copilote envoie à Google (ou à OpenAI si tu as ajouté une clé de secours et que Google échoue) :
  - l'enregistrement de ta question (pour la transcrire), puis sa transcription ;
  - jusqu'à 4 vues de la fenêtre de CK3 avec des zooms autour de la souris, avec la position du curseur dans la fenêtre, la taille de la fenêtre, le moment de chaque vue pendant ta question et si la souris était immobile ;
  - la version du jeu installée et la liste des extensions que tu possèdes (et donc celles qui te manquent), lues dans les fichiers du jeu ;
  - les extraits de l'Encyclopédie du jeu qui correspondent à ta question (textes tirés des fichiers de ton jeu) ;
  - les 4 derniers échanges des 10 dernières minutes (tes questions et les réponses), pour que « et ensuite ? » marche ;
  - ton prénom, si tu as réglé `COPILOTE_PRENOM` ;
  - les consignes du copilote lui-même (comment répondre, notes de référence sur le jeu).

  Pendant la réponse, Google peut faire des recherches Google de son choix (les sources apparaissent sous la réponse). Le texte de la réponse repart ensuite chez Google pour être lu à voix haute. Rien n'est envoyé à l'auteur du copilote.
- **Ce qui reste sur ton PC**, dans le dossier du copilote :
  - `.env` : ta clé et tes réglages ;
  - `memoire\copilote-ck3\` : réglages, position de l'icône, une copie des textes de l'Encyclopédie du jeu, et `derniere-capture.jpg`, l'image principale de la dernière question (remplacée à chaque question, gardée pour aider en cas de problème) ;
  - `journal\copilote-ck3\` : tes questions, les réponses et leur coût, et le journal de l'appli, `app.log`.
- **Réseau :** le petit serveur local du copilote n'écoute que sur ton propre PC (127.0.0.1) : personne sur ton réseau ne peut le joindre.
- **Offre gratuite de Google :** voir [la partie 2](#2-obtenir-une-clé-google-gemini).

### 11. En cas de problème

**Le copilote reste bloqué sur le jeu (plus rien ne réagit, impossible de le déplacer ou de le fermer).**
Appuie sur **Ctrl+Maj+Retour arrière** (la touche d'effacement, au-dessus d'Entrée) : le copilote repart à neuf (icône repliée, écoute et voix coupées). Appuie **deux fois** en moins de 2 secondes pour le fermer complètement ; même figé, il est arrêté de force au bout de 4 secondes. Le jeu ne reçoit pas ces touches. Tu peux aussi faire un clic droit sur l'icône ou le panneau : **Replier**, **Recharger**, **Quitter le copilote**. Le copilote se surveille aussi tout seul : s'il ne répond plus pendant une dizaine de secondes, il se replie et repart. Après 3 redémarrages de ce genre en 10 minutes, il n'essaie plus : l'icône reste repliée et l'info-bulle de l'icône du copilote près de l'horloge (passe la souris dessus) dit « Copilote CK3 arrêté : clic droit ici, « Réinitialiser le copilote » ». Clic gauche sur cette icône, ou clic droit > **Réinitialiser le copilote**, ou Ctrl+Maj+Retour arrière dans le jeu : l'icône et le panneau sont refaits à neuf. Si cette info-bulle dit plutôt « Copilote CK3 · Ctrl+Maj+Retour arrière pris par une autre appli : en cas de blocage, clic droit ici », un autre programme a pris le raccourci d'urgence : le menu du clic droit reste la porte de sortie.

**L'icône n'apparaît pas sur le jeu.**
L'icône ne s'affiche que quand CK3 est la fenêtre au premier plan. Si tu ne la vois toujours pas, passe CK3 en mode fenêtre : appuie sur **Échap**, puis **Settings** > **Graphics** > **Display Mode** > **Window** (le jeu est en anglais). Un clic sur l'icône du copilote près de l'horloge l'affiche aussi 15 secondes, et **Replacer l'icône et le panneau** la remet à sa place.

**Ctrl+Maj+Espace ne fait rien.**
Le raccourci ne marche que quand CK3 est la fenêtre au premier plan : clique d'abord dans le jeu. Sinon, clique plutôt sur l'icône micro. Si la ligne d'état dit « Raccourci indisponible : clique sur l'icône », un autre programme utilise ce raccourci. « (raccourci en bascule seulement) » veut dire que le raccourci marche, mais pas en talkie-walkie.

**« Le micro est bloqué ».**
Ouvre les **Paramètres** de Windows > **Confidentialité et sécurité** > **Micro** (ou **Microphone**, selon la version), et active **Accès au micro** et **Autoriser les applications de bureau à accéder à votre micro**. Sous Windows 10, des interrupteurs semblables sont dans **Paramètres > Confidentialité > Microphone**. Pour « Aucun micro trouvé », branche ton casque. Pour « Le micro ne répond pas », vérifie qu'aucun autre programme ne l'utilise et que le bon micro est choisi dans **Paramètres > Système > Son > Entrée**.

**« Electron not found / Electron introuvable » au lancement, ou Windows affiche « Problème de raccourci ».**
L'installation n'est pas finie, ou le dossier du copilote a été déplacé. Double-clique de nouveau sur `Installer-Copilote-CK3.cmd` : elle termine l'installation et refait le raccourci du Bureau. Si la fenêtre noire propose aussi des commandes `npm`, ignore-les : l'installation s'en charge. Si une boîte Windows intitulée « Le Copilote CK3 n'a pas pu démarrer » s'affiche à la place, lis sa ligne « Cause » : elle dit ce qui a échoué, et nomme le fichier où est le détail, `journal\copilote-ck3\app.log` dans le dossier du copilote ; joins ce fichier si tu signales le problème.

**Windows refuse d'ouvrir l'installation.**
Clic droit sur le fichier ZIP téléchargé > **Propriétés** > coche **Débloquer** en bas > **OK**, puis extrais-le de nouveau. Si l'installation dit que tu l'as ouverte « depuis l'intérieur du ZIP », extrais d'abord le ZIP (voir [la partie 3](#3-télécharger-le-copilote)).

**Ton antivirus se méfie du copilote.**
Le copilote a une petite aide Windows, `aide-windows.ps1`, lancée par Windows PowerShell sans fenêtre visible (et, comme l'installation, avec `-ExecutionPolicy Bypass`, voir [la partie 4](#4-lancer-linstallation)) : certains antivirus se méfient de tout « PowerShell caché » rien que pour ça. Elle fait aussi deux choses que les antivirus surveillent de près :

- elle capture la fenêtre de CK3 (et seulement elle) pour la montrer à l'IA ;
- elle utilise un **crochet clavier bas niveau**, la fonction de Windows qui permet aussi à un programme de voir les touches tapées dans les autres fenêtres. Les enregistreurs de frappe s'en servent aussi, d'où la méfiance de certains antivirus. Ici, l'aide ne réagit qu'à deux combinaisons, **Ctrl+Maj+Espace** et **Ctrl+Maj+Retour arrière** (le raccourci d'urgence), et seulement quand CK3 est au premier plan : elle retient ces deux-là (sinon CK3 verrait aussi Espace et mettrait le jeu en pause ou le relancerait), laisse passer toutes les autres touches sans y toucher, n'enregistre rien et n'envoie rien. Elle n'envoie jamais de touche ni de clic. Il faut un crochet parce que le système de raccourcis normal de Windows ne sait pas quand les touches sont relâchées (nécessaire pour le mode talkie-walkie), et prendrait le raccourci à tous les autres programmes.

Le code est ouvert : tu peux lire `aide-windows.ps1`, ou demander à quelqu'un de confiance de le vérifier. Si ton antivirus a mis un fichier en quarantaine, tu peux le restaurer et autoriser le dossier du copilote, ou simplement ne pas utiliser le copilote. Ne désactive pas ton antivirus.

**Pas de réponse, ou « Aucune clé d'IA trouvée ».**
Ces messages s'affichent dans le panneau de réponse. Quand Google échoue, le copilote passe par OpenAI si tu lui as donné une clé OpenAI (« je passe par OpenAI ») ; sans elle, le message se termine par « et pas de clé OpenAI pour prendre le relais », et il n'y a pas de réponse.
- « Aucune clé d'IA trouvée » : la clé manque dans `.env`. Relance l'installation, elle te la demandera.
- « Crédit Google épuisé » : ajoute du crédit dans Google AI Studio (Billing). Le copilote passe ensuite par OpenAI pendant 5 minutes avant de réessayer Google.
- « Quota Google du jour atteint » : le quota du jour de ta clé est épuisé (offre gratuite). Attends le lendemain, ou active la facturation (voir [la partie 2](#2-obtenir-une-clé-google-gemini)). Mêmes 5 minutes par OpenAI.
- « Google limite le rythme (trop de demandes) » ou « Google est surchargé » : avant d'afficher ce message, le copilote a déjà réessayé une fois tout seul, après le délai demandé par Google (8 secondes au plus). Repose ta question dans un moment.
- « Google ne connaît plus le modèle » : Google a retiré le modèle que le copilote utilise. Télécharge la nouvelle version (voir [la partie 12](#12-mettre-à-jour)).
- « Clé Google refusée » : la clé dans `.env` est fausse, ou a été supprimée dans AI Studio. Voir « Mauvaise clé enregistrée, ou nouvelle clé ? » plus bas.
- « Google ne répond pas » : vérifie ta connexion Internet, et que ta clé existe toujours dans AI Studio. Avec une clé gratuite, voir [la partie 2](#2-obtenir-une-clé-google-gemini).

**Mauvaise clé enregistrée, ou nouvelle clé ?**
L'installation garde une clé déjà enregistrée et ne la redemande pas. Ouvre `.env` avec le Bloc-notes (voir [la partie 8](#8-langue-voix-et-autres-réglages)), remplace le texte après `GEMINI_API_KEY=` par ta nouvelle clé (sans espace ni guillemets), enregistre, puis relance le copilote.

**« Encyclopédie introuvable » dans le panneau de réponse.**
Affiché une fois, à ta première question ; le copilote répond quand même (« Je réponds sans elle »), mais il ne peut plus citer les textes exacts de ta version. Il cherche CK3 là où Steam l'a installé (le dossier de Steam, lu dans le registre de Windows, et les bibliothèques que Steam déclare), et le message nomme les dossiers Steam où il a regardé. Si Steam ou le jeu est à un endroit inhabituel, ouvre `.env` avec le Bloc-notes (voir [la partie 8](#8-langue-voix-et-autres-réglages)) et donne le dossier du jeu sur la ligne `COPILOTE_CK3_DIR=`, par exemple `COPILOTE_CK3_DIR=D:\SteamLibrary\steamapps\common\Crusader Kings III` (dans Steam : clic droit sur le jeu > **Gérer** > **Parcourir les fichiers locaux** ouvre ce dossier), puis relance le copilote. Si le message dit plutôt que `COPILOTE_CK3_DIR` n'est pas le dossier de Crusader Kings III, le chemin est faux : ce doit être le dossier qui contient `launcher\launcher-settings.json`.

**« CK3 n'est pas lancé » alors que le jeu est ouvert.**
CK3 doit être lancé et pas réduit. Clique dans le jeu, puis repose ta question.

**« Aide Windows en panne : capture impossible » dans la ligne d'état.**
La petite aide Windows du copilote, `aide-windows.ps1` (le PowerShell qui capture le jeu et gère le raccourci), s'est arrêtée ou n'a pas pu démarrer : en général un antivirus, ou un réglage de Windows qui bloque PowerShell (voir « Ton antivirus se méfie du copilote » plus haut). Le copilote la relance tout seul (après 1, 2 puis 4 secondes, 3 fois par minute au plus), puis réessaie environ une minute plus tard et de moins en moins souvent ; en attendant, il ne peut pas regarder le jeu. Si ça dure, quitte le copilote (clic droit sur son icône près de l'horloge > **Quitter**) et relance-le ; la raison est dans `journal\copilote-ck3\app.log`.

**La réponse arrive dans la mauvaise langue.**
Clic droit sur l'icône du copilote près de l'horloge > **Langue / Language**.

**Une réponse fausse ?**
Le copilote est en bêta et peut se tromper. Tu peux le signaler dans l'onglet [Issues](https://github.com/ameuryamani-lab/copilote-ck3/issues), avec la question que tu as posée.

### 12. Mettre à jour

1. Quitte le copilote (clic droit sur son icône près de l'horloge > **Quitter**).
2. Télécharge le nouveau ZIP et extrais-le **au même endroit que la première fois** (par exemple `%USERPROFILE%\CK3-Copilot`), pour qu'il arrive dans le même dossier `copilote-ck3-main`. Quand Windows le demande, choisis **Remplacer les fichiers dans la destination**. Ton `.env`, tes réglages et tes journaux ne sont pas dans le ZIP : ils sont gardés.
3. Double-clique de nouveau sur `Installer-Copilote-CK3.cmd` : il met Electron à jour si besoin.

### 13. Désinstaller

1. Quitte le copilote (clic droit sur son icône près de l'horloge > **Quitter**).
2. Supprime le dossier du copilote (`copilote-ck3-main`). Cela supprime aussi ta clé, tes réglages et tes journaux.
3. Supprime le raccourci **CK3 Copilot** de ton Bureau.
4. Facultatif : supprime les dossiers `%APPDATA%\copilote-ck3` (les données d'Electron pour le copilote) et `%LOCALAPPDATA%\electron\Cache` (le téléchargement d'Electron, environ 150 Mo ; d'autres programmes basés sur Electron que tu installes toi-même peuvent s'en servir aussi). Tape ces noms dans la barre d'adresse de l'Explorateur de fichiers pour les ouvrir.
5. Facultatif : désinstalle Node.js (**Paramètres > Applications**) si tu ne t'en sers pas pour autre chose, et supprime ta clé dans Google AI Studio si tu ne l'utilises plus.
