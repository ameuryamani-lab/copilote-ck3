# CK3 Copilot

A voice copilot for **Crusader Kings III** on Windows. A small microphone icon floats over the game: ask your question out loud, and the copilot looks at your screen by itself, then answers in text and out loud, quoting the game's buttons exactly as they appear on screen.

No more taking photos of your screen with your phone to ask an AI for help.

> **Beta.** This is a personal project, version 0.1, still in beta. It is provided as is, without any warranty. Found a bug or have an idea? You are welcome to share it in [Issues](https://github.com/ameuryamani-lab/copilote-ck3/issues).

> **Language:** the copilot answers in **English or French**, your choice in the tray icon menu (**Langue / Language**). By default it follows your Windows language. Button names are always quoted in English, exactly as in the game. The code comments are in French.
>
> *Version française plus bas.*

## What it does

- **It looks at the screen by itself.** For every question, it captures the CK3 window, plus a zoom around the mouse cursor to read the tooltip you are hovering. You never take a screenshot.
- **It keeps it short.** The answer in one sentence, then 2 to 4 numbered steps ("click **Declare War**"). 70 words at most.
- **It knows your version of the game.** It reads the in-game Encyclopedia installed on your PC (the exact texts of your version and the expansions you own) and checks Google when needed. It never gives a number from memory.
- **It never touches the game.** No key and no click is ever sent: it only advises. The game does not pause by itself: press Space if you want to take your time.
- **It follows the conversation.** It remembers the last 4 exchanges for 10 minutes, so you can ask "and then?".

## How to use it

- **Ctrl+Shift+Space** or **click the icon**: it listens and stops by itself when you stop talking.
- **Hold Ctrl+Shift+Space** (more than half a second): it listens as long as you hold the keys, like a walkie-talkie.
- Drag the answer panel anywhere: it stays there.
- The icon only shows while CK3 is in the foreground.
- Tray icon menu (next to the clock): voice on or off, forget the conversation, reset the icon and panel position, **Langue / Language** (Français / English), quit. Changing the language also clears the conversation.

## Installation (Windows 10 or 11)

You need:

- Crusader Kings III on Steam, in English;
- [Node.js](https://nodejs.org) 22 or newer (only to install);
- a Google Gemini API key, from [Google AI Studio](https://aistudio.google.com/apikey). An OpenAI key is optional: it is used as a fallback when Google refuses (no credit left, outage).

Steps:

1. Download this folder: green **Code** button, then **Download ZIP** (or `git clone https://github.com/ameuryamani-lab/copilote-ck3`).
2. Open a terminal in the folder and run these two commands:
   ```
   npm install
   node node_modules\electron\install.js
   ```
   The second one downloads Electron (about 150 MB), the app's engine: since Electron 44, `npm install` no longer does it.
3. Copy `.env.example` to `.env` and paste your key after `GEMINI_API_KEY=`.
4. Start CK3, then double-click `Lancer-Copilote-CK3.cmd`. The microphone icon appears at the bottom right of the screen.

Optional settings in `.env`:

- `COPILOTE_LANGUE=en` or `fr`: the answer language until you pick one in the tray menu (otherwise your Windows language is used);
- `COPILOTE_PRENOM=YourFirstName`: tells the copilot your first name (without it, it simply talks to "the player").

Tested with CK3 1.20 (no expansion), in "Fullscreen" mode at 1920 × 1080, on a single screen.

## Cost

About 1 cent ($0.01) per question with Gemini (Gemini 3.8 Flash, Google Search and Gemini voice), so $0.25 to $0.50 for two hours of play. Prices checked on 6 October 2026, with Google's promotional rates valid until the end of 2026: they may change.

Every question is logged with its cost in `journal/copilote-ck3/`.

## Privacy

- The app only listens on your own PC (127.0.0.1): nobody on your network can reach it.
- The microphone only opens when you ask.
- For each question, only your question and the capture of the CK3 window are sent to Google (or to OpenAI as a fallback).
- Your key stays in `.env`, which is never published (see `.gitignore`).

## Under the hood

| File | Role |
|---|---|
| `main.mjs` | The Electron app: icon, panel, tray menu. |
| `aide-windows.ps1`, `aide-windows.mjs` | Captures the game window (PrintWindow) and handles the keyboard shortcut; nothing is ever sent to the game. |
| `serveur.mjs` | Small local server (127.0.0.1:8802) between the icon's page and the brain. |
| `agent/copilote-jeu.mjs` | The brain: Gemini, Google Search, voice, and OpenAI as a fallback. |
| `agent/copilote-ck3-savoir.mjs` | Reads the Encyclopedia of the installed game and caches it, rebuilt after every CK3 update. |
| `page/` | The icon and the answer panel; `page/textes.js` holds the interface texts in both languages. |
| `essais/` | Automated tests. `node essais/essai-page.mjs` is free; the others call the API and cost a few cents. |

## Version française

Un copilote vocal pour Crusader Kings III, sous Windows. Une petite icône micro reste au-dessus du jeu : tu poses ta question à voix haute, il regarde lui-même ton écran et te répond à l'écrit et à voix haute, avec les noms exacts des boutons du jeu (en anglais, comme à l'écran). Il ne touche jamais au jeu : il conseille seulement.

- **Bêta :** c'est un projet personnel, version 0.1, encore en bêta. Il est fourni tel quel, sans aucune garantie. Un bug ou une idée ? Tu peux les signaler dans l'onglet [Issues](https://github.com/ameuryamani-lab/copilote-ck3/issues).
- **Langue :** français ou anglais, au choix dans le menu de l'icône (« Langue / Language ») ; par défaut, la langue de Windows.
- **Utilisation :** Ctrl+Maj+Espace ou clic sur l'icône (maintenir les touches pour parler comme avec un talkie-walkie).
- **Installation :** `npm install`, puis `node node_modules\electron\install.js` (télécharge Electron, environ 150 Mo). Copie ensuite `.env.example` en `.env`, colle ta clé Google Gemini après `GEMINI_API_KEY=`, lance CK3 et double-clique sur `Lancer-Copilote-CK3.cmd`.
- **Coût :** environ 1 cent par question.
- **Vie privée :** seules ta question et la capture de la fenêtre de CK3 partent chez Google. Ta clé reste sur ton PC.
- **Licence :** GNU GPL version 3 (GPL-3.0). Tu es libre d'utiliser, d'étudier, de modifier et de partager ce programme. Si tu distribues une version modifiée, elle doit rester sous GPL-3.0 et être accompagnée de son code source. Les polices Exo 2 et Rajdhani gardent leur propre licence, la SIL Open Font License 1.1.

## Credits

Created by Ameur Yamani (TikTok [@ameur.y](https://www.tiktok.com/@ameur.y), Instagram [@ameuryamani](https://www.instagram.com/ameuryamani)), built with Claude Code.

Fan project, not affiliated with Paradox Interactive. Crusader Kings is a trademark of Paradox Interactive.

## License

Copyright (C) 2026 Ameur Yamani

This program is free software under the GNU General Public License, version 3 only (GPL-3.0-only). You are free to use, study, modify and share it. If you distribute a modified version, it must stay under GPL-3.0 and come with its source code. Full text in the `LICENSE` file.

The Exo 2 and Rajdhani fonts are separate files that keep their own license, the SIL Open Font License 1.1 (`page/polices/OFL.txt`), which allows them to be shipped with GPL software.
