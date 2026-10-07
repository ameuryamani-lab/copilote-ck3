# CK3 Copilot

A voice copilot for **Crusader Kings III** on Windows. A small microphone icon floats over the game: ask your question out loud, and the copilot looks at your screen by itself, then answers in text and out loud, quoting the game's buttons exactly as they appear on screen.

No more taking photos of your screen with your phone to ask an AI for help.

<img src="docs/copilot-in-game-en.png" width="1100" alt="The CK3 Copilot answer panel next to the Tips window in Crusader Kings III">

*A real answer from the copilot for this screen. New to this? The **[step-by-step guide](TUTORIAL.md)** explains everything, with pictures.*

> **Beta.** This is a personal project, version 0.1, still in beta. It is provided as is, without any warranty. Found a bug or have an idea? You are welcome to share it in [Issues](https://github.com/ameuryamani-lab/copilote-ck3/issues).

> **Language:** the copilot answers in **English or French**, your choice in the tray icon menu (**Langue / Language**). By default it follows your Windows language. Button names are always quoted in English, exactly as in the game. The code comments are in French.
>
> *Version française plus bas.*

## What it does

- **It looks at the screen by itself, during your whole question.** From the moment you press the keys until you stop talking, it keeps watching the CK3 window (a light look about once per second) and sends up to 4 views with your question, plus a zoom around the mouse cursor to read the tooltip you are hovering. So you can say "look at this" while you hover something or open a window. You never take a screenshot.
- **It keeps it short.** The answer in one sentence, then 2 to 4 numbered steps ("click **Declare War**"). 70 words at most.
- **It knows your version of the game.** It reads the in-game Encyclopedia installed on your PC (the exact texts of your version and the expansions you own) and checks Google when needed. It never gives a number from memory.
- **It never touches the game.** No key and no click is ever sent: it only advises. The game does not pause by itself: press Space if you want to take your time.
- **It follows the conversation.** It remembers the last 4 exchanges for 10 minutes, so you can ask "and then?".

## How to use it

- **Ctrl+Shift+Space** or **click the icon**: it listens and stops by itself when you stop talking.
- **Hold Ctrl+Shift+Space** (more than half a second): it listens as long as you hold the keys, like a walkie-talkie.
- **Show it things while you talk:** hover or open what you mean, and stop the mouse for half a second on it, so the game's tooltip has time to open and the copilot catches it.
- Drag the answer panel anywhere: it stays there.
- The icon only shows while CK3 is in the foreground.
- Tray icon menu (next to the clock): voice on or off, forget the conversation, reset the icon and panel position, **Langue / Language** (Français / English), quit. Changing the language also clears the conversation.

## Installation (Windows 10 or 11)

You need:

- Crusader Kings III on Steam, in English;
- [Node.js](https://nodejs.org) 22 or newer (only to install);
- a Google Gemini API key, from [Google AI Studio](https://aistudio.google.com/apikey). Setting up billing is recommended: on Google's free tier, what you send may be used to improve Google's products, and Google Search checks are not available (details in the [guide](TUTORIAL.md#2-get-a-google-gemini-key)). An OpenAI key is optional: it is used as a fallback when Google refuses (no credit left, outage).

Steps:

1. Download this folder: green **Code** button, then **Download ZIP**. Right-click the ZIP > **Extract All...**.
2. In the extracted folder, double-click **`Installer-Copilote-CK3.cmd`**. It checks Node.js (and offers to open nodejs.org if it is missing), installs Electron, the app's engine (about 150 MB), asks for your Gemini key (kept in `.env`, on your PC only) and creates a **CK3 Copilot** shortcut on the desktop. You can run it again at any time: it only does what is missing.
3. Start CK3, then double-click **CK3 Copilot** on the desktop (or `Lancer-Copilote-CK3.cmd`). The microphone icon appears on the right of the screen.

The **[step-by-step guide](TUTORIAL.md)** walks through each step with pictures, and has a troubleshooting section (icon not visible, microphone blocked, antivirus warning...).

Manual install, for developers (Node.js 22.12 or newer):

```
git clone https://github.com/ameuryamani-lab/copilote-ck3
cd copilote-ck3
npm ci
node node_modules\electron\install.js
copy .env.example .env
```

The `install.js` line downloads Electron: since Electron 44, `npm install` no longer does it. Then paste your key after `GEMINI_API_KEY=` in `.env` and run `npm start` (or `Lancer-Copilote-CK3.cmd`).

Optional settings in `.env`:

- `COPILOTE_LANGUE=en` or `fr`: the answer language until you pick one in the tray menu (otherwise your Windows language is used);
- `COPILOTE_PRENOM=YourFirstName`: tells the copilot your first name (without it, it simply talks to "the player").

Tested with CK3 1.20 (no expansion), in "Fullscreen" mode at 1920 × 1080, on a single screen.

## Cost

About 1 cent ($0.01) per question with Gemini (Gemini 3.8 Flash, Google Search and Gemini voice), so $0.25 to $0.50 for two hours of play. Prices checked on 7 October 2026, with Google's promotional rates valid until the end of 2026; Google has announced they double on 1 January 2027 (close to 2 cents per question).

Every question is logged with its cost in `journal/copilote-ck3/`.

## Privacy

- The app only listens on your own PC (127.0.0.1): nobody on your network can reach it.
- The microphone only opens when you ask.
- Only the CK3 window is captured, never the rest of the screen, and only during a question. For each question, only your question and up to 4 views of the CK3 window are sent to Google (or to OpenAI as a fallback). The views stay in memory; only the last image sent is kept on disk (`memoire/copilote-ck3/derniere-capture.jpg`, replaced at every question) to help with troubleshooting.
- On Google's free tier, Google may use what you send to improve its products; on the paid tier, it does not.
- Your key stays in `.env`, which is never published (see `.gitignore`).

## Under the hood

| File | Role |
|---|---|
| `Installer-Copilote-CK3.cmd`, `installer.ps1` | The installer: checks Node.js, installs Electron, asks for the key, creates the desktop shortcut. |
| `main.mjs` | The Electron app: icon, panel, tray menu. |
| `aide-windows.ps1`, `aide-windows.mjs` | Captures the game window (PrintWindow) and handles the keyboard shortcut; nothing is ever sent to the game. |
| `serveur.mjs` | Small local server (127.0.0.1:8802) between the icon's page and the brain. |
| `agent/copilote-jeu.mjs` | The brain: Gemini, Google Search, voice, and OpenAI as a fallback. |
| `agent/copilote-ck3-savoir.mjs` | Reads the Encyclopedia of the installed game and caches it, rebuilt after every CK3 update. |
| `page/` | The icon and the answer panel; `page/textes.js` holds the interface texts in both languages. |
| `essais/` | Automated tests. `node essais/essai-page.mjs` is free; the others call the API and cost a few cents. |
| `TUTORIAL.md`, `docs/` | The step-by-step guide and its pictures. |

## Version française

Un copilote vocal pour Crusader Kings III, sous Windows. Une petite icône micro reste au-dessus du jeu : tu poses ta question à voix haute, il regarde lui-même ton écran et te répond à l'écrit et à voix haute, avec les noms exacts des boutons du jeu (en anglais, comme à l'écran). Il ne touche jamais au jeu : il conseille seulement.

- **Bêta :** c'est un projet personnel, version 0.1, encore en bêta. Il est fourni tel quel, sans aucune garantie. Un bug ou une idée ? Tu peux les signaler dans l'onglet [Issues](https://github.com/ameuryamani-lab/copilote-ck3/issues).
- **Langue :** français ou anglais, au choix dans le menu de l'icône (« Langue / Language ») ; par défaut, la langue de Windows.
- **Utilisation :** Ctrl+Maj+Espace ou clic sur l'icône (maintenir les touches pour parler comme avec un talkie-walkie).
- **Il regarde pendant toute ta question :** de l'appui jusqu'à la fin de ta phrase, il garde un œil sur la fenêtre de CK3 (un coup d'œil léger environ une fois par seconde) et envoie jusqu'à 4 vues avec ta question. Tu peux donc dire « regarde ça » en survolant quelque chose. Astuce : arrête la souris une demi-seconde sur ce que tu veux lui montrer, le temps que l'info-bulle du jeu s'ouvre.
- **Installation :** télécharge le ZIP (bouton vert **Code**, puis **Download ZIP**), extrais-le, puis double-clique sur **`Installer-Copilote-CK3.cmd`** : il vérifie Node.js, installe Electron (environ 150 Mo), te demande ta clé Google Gemini et crée un raccourci **CK3 Copilot** sur le Bureau. Lance ensuite CK3, puis le raccourci. Tout est expliqué pas à pas, avec des images, dans le **[guide](TUTORIAL.md#version-française)**. Installation à la main pour les développeurs : les commandes de la partie anglaise.
- **Coût :** environ 1 cent par question jusqu'à fin 2026, près de 2 cents à partir du 1er janvier 2027 (Google double alors ses prix).
- **Vie privée :** seule la fenêtre de CK3 est capturée, et seulement pendant une question. Seules ta question et jusqu'à 4 vues de cette fenêtre partent chez Google. Ta clé reste sur ton PC. Avec l'offre gratuite de Google, ce que tu envoies peut servir à améliorer ses produits : la facturation est conseillée (voir le guide).
- **Licence :** GNU GPL version 3 (GPL-3.0). Tu es libre d'utiliser, d'étudier, de modifier et de partager ce programme. Si tu distribues une version modifiée, elle doit rester sous GPL-3.0 et être accompagnée de son code source. Les polices Exo 2 et Rajdhani gardent leur propre licence, la SIL Open Font License 1.1.

## Credits

Created by Ameur Yamani (TikTok [@ameur.y](https://www.tiktok.com/@ameur.y), Instagram [@ameuryamani](https://www.instagram.com/ameuryamani)), built with Claude Code.

Fan project, not affiliated with Paradox Interactive. Crusader Kings is a trademark of Paradox Interactive.

## License

Copyright (C) 2026 Ameur Yamani

This program is free software under the GNU General Public License, version 3 only (GPL-3.0-only). You are free to use, study, modify and share it. If you distribute a modified version, it must stay under GPL-3.0 and come with its source code. Full text in the `LICENSE` file.

The Exo 2 and Rajdhani fonts are separate files that keep their own license, the SIL Open Font License 1.1 (`page/polices/OFL.txt`), which allows them to be shipped with GPL software.
