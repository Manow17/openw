# OpenW

A free, open-source cosmetic mod manager for Rocket League on Windows (Epic Games and Steam).

No account, no subscription, no server. Everything runs on your PC, and every game file OpenW changes is backed up first and can be put back with one click.

OpenW used to be called Boostpad. On its first start it moves the old data folder (`%APPDATA%\boostpad`: settings, the record of every change, and the backups of original game files) to `%APPDATA%\OpenW`; if the folder is in use it is copied instead and the old one is left as it was.

> **Status: early (v0.3).** The app, the backup engine, workshop maps, mod packs, presets, tracker, overlay and profile cards work. **Item swaps are experimental and have not been confirmed in game yet** — see [What works](#what-works) before you rely on them.

| Dark | Light |
| --- | --- |
| ![Garage, dark theme](docs/garage.png) | ![Garage, light theme](docs/garage-light.png) |

![Overlay page](docs/overlay.png)

## Read this first

- Rocket League runs with Easy Anti-Cheat. OpenW does **not** touch, disable or work around it, and it never injects into or reads the running game. It only replaces files on disk while the game is closed.
- Changing game files may break Rocket League's terms of service and could put your account at risk. Nobody can promise modified files are accepted online. **Use it at your own risk.**
- Your launcher's "Verify files" always restores a clean install.
- OpenW is a fan project, not affiliated with or endorsed by Psyonix or Epic Games.

## Features

| Tab | What it does |
| --- | --- |
| **Garage** | Give an item you own the look of another item (cars, wheels, boosts, decals, toppers, antennas, engine sounds, trails, goal explosions, paint finishes, banners, borders, anthems). Items are shown with their real names and pictures, read from your own game files, and each section lists only its own items. A search stays in the section you are in and tells you which other sections also have a match. Once you pick your item, only the looks that work with it are listed. Everything applied or queued is listed there with a Revert button. |
| **Workshop Maps** | Load a training/challenge map into the Underpass slot and play it from Free Play. |
| **Map Merge** | Mix the game's own arenas: put the stadium of any soccar arena into the surroundings of any other, make an arena snowy where the game has a snowy version, or see the same arena, merged ones too, in every match. Arenas are listed under the names the game uses, and each change says which arena to play to see it. Experimental. |
| **Controller** | **OpenW Input**: a controller remapper with Steam Input's stick, trigger and button options and more, for any game, Epic or Steam. It reads your Xbox, DualShock 4, DualSense or DualSense Edge controller and plays the result on a virtual Xbox controller. Profiles, live view of what your stick does and what the game gets. See [OpenW Input](#openw-input). |
| **Presets** | Save everything that is active and switch setups in one click. Unlimited. Copy a preset as a code to pass it on. |
| **Swap queue** | Changes made while the game is running wait and go in when it closes. |
| **Overlay** | Click-through windows over the game, shown only while Rocket League is the window in front. A now-playing pill for your music, and a top-down PS5, PS4 or Xbox controller (picked automatically from the one plugged in) that lights up with your inputs. Each has its own position (drag it, or pick a corner), size and look. |
| **Profile** | A profile card with any name, title, colour, glow, rank badge and picture. It lives in the app. |
| **Themes** | Dark or light. Both use the icon's turquoise; the light theme adds charcoal blocks. |

### OpenW Input

OpenW Input is a small helper (`native/openw-input.cpp`, built to `bin/openw-input.exe`) that OpenW runs while it is switched on. It reads your controller (Xbox and other XInput controllers through XInput; DualShock 4, DualSense and DualSense Edge as raw HID reports, over USB or Bluetooth), runs every report through your profile at once, and sends the result to a virtual Xbox 360 controller. Nothing waits for a timer, so it adds no frame of delay.

**The sticks compute exactly what Steam Input computes.** Steam does not publish its formulas or defaults, so they were measured from the Steam client itself: about 9,000 stick positions under 61 setting combinations, read from Steam's own live preview. OpenW reproduces every one to within 5 of 32767, and `npm test` checks that against the measured points. The settings are Steam's, with Steam's names, numbers and defaults: Deadzone source (None, Calibration, Custom), Deadzone inner and outer (shown as % of the stick's travel, like every stick and trigger value; underneath they are Steam's numbers, 0–32000 of 32767), Deadzone shape (Cross, Circle, Square), Anti-deadzone and its buffer, Stick response curve (Linear, Aggressive, Relaxed, Wide, Extra Wide, Custom 25–375), horizontal and vertical scale, invert, output joystick and the outer ring command. How it works, and what was not measured (triggers), is in [docs/steam-input.md](docs/steam-input.md).

**Import from Steam** copies a Steam Input layout from this PC into a new profile with the same numbers: both sticks, triggers, every button bound to an Xbox button (including long press, toggle and turbo, and the touchpad's left and right halves, which Steam treats as two buttons), and your Steam lightbar colour. Bindings OpenW cannot play (keys, mouse) are listed when importing.

More than Steam: smoothing for a shaky stick, hair triggers, and rumble strength.

**Drivers come with OpenW: nothing to download.** The virtual controller needs ViGEmBus, a free, signed driver by Nefarius Software Solutions (the one DS4Windows uses). OpenW ships its official installer, and HidHide's, in [`drivers/`](drivers/README.md). The OpenW setup installs both (see [Install](#install)); run from source, OpenW checks them against their SHA-256 and installs both silently, together, the first time you turn OpenW Input on. Windows' own permission prompt is the only thing you see (no app can skip it for a driver); the app itself never shows a driver step. If Windows wants a restart to finish, a message says so. Remove them any time under Windows Settings, Apps. Only a driver can add a controller that games see, and on Windows 10 and 11 with Secure Boot a driver only loads if it is signed through Microsoft, which needs a company code-signing certificate. The one way around that, Windows' test-signing mode, is not supported by Easy Anti-Cheat ([Facepunch support](https://support.facepunchstudios.com/hc/en-us/articles/214240705-Driver-Signature-Enforcement-has-been-disabled)), so Rocket League would not run. Windows' own driverless gamepad injection (`InputInjector`) refuses to start for a desktop app (tested), and games read controllers through XInput, which would not see it anyway. So OpenW ships ViGEmBus rather than a driver of its own.

**Hiding the real controller**, so games do not get every press twice. With *Hide your controller from games* on (the default), OpenW hides every real controller from all apps except its helper while OpenW Input is on, through [HidHide](https://github.com/nefarius/HidHide/releases), and shows it again the moment OpenW Input turns off or OpenW quits (and on the next start, if OpenW was killed). HidHide needs no administrator rights for this, so there is no prompt. Its filter attaches to a controller when the controller connects, so the setup restarts the connected controllers right after installing it; a controller that was plugged in before HidHide arrived some other way needs one reconnect, and the page says so. Without HidHide, a PlayStation controller is instead opened for the helper alone, which works only if no other app (Steam, or Windows' own GameInput service) has it open.

Rocket League's own controller dead zone is best turned down, since OpenW Input handles it.

### Music in the overlay

The now-playing pill reads Windows' own media controls, so there is no login and no API key, and it works with anything that shows up in the Windows volume flyout: Spotify, Apple Music, TIDAL, Deezer, Amazon Music, Qobuz, YouTube Music and SoundCloud in a browser, VLC, foobar2000, MusicBee, AIMP and Windows Media Player. You can follow one app or whichever is playing. It follows music playing on this PC, not on your phone.

### Map Merge

Any two standard soccar arenas can be merged (61 on the test machine), strictly: only the stadium of the arena you pick as the stadium shows (pitch, walls, goals, stands, crowd), and around it only the outside, sky and fog of the arena you place it in. Nothing of the stadium arena's outside and nothing of the other arena's stadium comes along.

Every merge is built at the object level (`src/main/core/mapbuild.js`). Arenas are a main `_P` map plus part files it loads by name (`_Field`, `_OOB`, effects, sound); older ones keep stadium and outside together in the main map. OpenW reads both arenas and sorts every placed piece:

- **Where each stadium is.** An arena's stadium is the pitch area (walls and goals) plus the footprint of each of its stands, measured from the map: every mesh named like stands or crowd, placed with its component's translation, rotation and scale, mirrored both ways. Parc de Paris has stands only behind the goals, so its open park sides are outside, not stadium.
- **Stadium side.** Pieces mostly inside that region stay, plus flat ground centred under it and pieces named after the stadium that stick out a little (outer arches). Anything named OOB, the sky, clouds and fog are hidden. Gameplay (boost pads, goals, spawns, collision) and the stadium's lights stay.
- **Outside side.** Pieces inside either stadium are hidden, so nothing of the place arena's stadium shows and nothing stands inside the new one. Sky, clouds and fog stay; gameplay and lights are taken out of the level. Big flat ground below the pitch stays, so the stadium does not float over a hole.

The place arena stays its own map: its main file keeps everything (sky, lights, fog, surroundings, gameplay, collision) except its stadium pieces and anything standing where the new stadium goes. Its stadium file (and, when more room is needed, a sound part, whose background sounds then go quiet) is renamed in its name table to new files OpenW adds, holding only the stadium arena's stadium pieces: from its stadium file, its main map and any part that holds some of its stadium (Champions Field's upper ring is in CS_OOB2), without their gameplay, lights, sky or fog. The place arena's outside parts load as filtered copies; its effects and lights parts load as they are. A place arena with no stadium file and no sound part (Mannfield and Mannfield (Dusk) are single files) gets the other way round: the stadium arena's map is the base and the place arena's map, sky included, loads in its parts; its light and fog are then the stadium arena's, and the page says so. Every edit keeps sizes the same (a mesh reference set to none, an actor reference cleared, a name shortened in place), so only the compressed chunks and the chunk table change; added files use the game's common key and are deleted again on revert.

Sorting is by name and position, so an odd piece can still land on the wrong side. Checked in game on the test machine with the earlier, looser sorting (0.1.2-0.1.5): stadium-file swaps (Neon Fields in AquaDome, Fire & Ice in Salty Shores (Night)) and whole-arena swaps load and play. 0.1.6 used the stadium arena's map as the base, which left the sky black when the place arena's main map did not fit (Beckwith Park (Snowy) in Forbidden Temple (Day)); 0.1.7 keeps the place arena's map. Checked against the real maps (what each side keeps), **not in game yet**. Hoops, Dropshot, Snow Day and odd-shaped arenas are left out, because the pitch shape comes with the stadium.

Changes are written while Rocket League is closed. The game keeps the arena files it read at start, so a file changed while it runs only shows after a restart.

**Snow.** Falling snow exists only inside the game's four snowy arenas (DFH Stadium, Mannfield, Beckwith Park and Utopia Coliseum, snowy versions); a search of every package found no separate snow file. So an arena built on one of those four becomes its snowy version, swapped in whole. Merged arenas cannot get snow, because the snowy version would replace the files the merge changed; merging a stadium into Forbidden Temple (Fire & Ice) or into one of the snowy arenas gives snowy surroundings instead. (0.1.2 and earlier offered "snow" from Forbidden Temple (Fire & Ice)'s effects file; checked in game, that file is its fire dragon, so the option is gone.)

**Same arena every match** makes every standard soccar arena file a copy of the one you pick, so whatever arena a match is played in, you see that one. Your merged arenas can be picked too: a stadium or surroundings merge comes along because the copied main file loads the merged files by name (checked in game: Mannfield set to load AquaDome's main file showed all of AquaDome), and for a whole-arena merge the arena merged in is used. Arenas you merged or snowed yourself keep your change. Rocket Labs, Hoops, Dropshot, Snow Day, Knockout and odd-shaped arenas are left alone. A built merge is built once and written into each arena file (about 10 seconds for 60 arenas), with a count on the button while it writes. The originals are backed up first; the page shows the disk space that takes before you turn it on (a merge built on a large map takes more, about 4.4 GB for 60 arenas). If you merge, change or revert the arena it shows afterwards, Update every match brings it in line.

## What works

| Area | State |
| --- | --- |
| Finding the game (Epic, Steam), running check, Play button | Tested on an Epic install. Epic installs are looked for in Epic's manifest folder (wherever ProgramData is, and the one Epic records in the registry), the launcher's list of installed games, the usual Epic folders on every drive, and finally a running Rocket League's own folder, so a launcher that keeps its records somewhere new still works |
| Backup, restore, queue, game-update detection | Covered by automated tests on copies of real game files |
| Item catalog and pictures | Built from your own install (about 8,600 items on the test machine). Pictures are decoded from the game's thumbnail packages and cached: about two thirds with the built-in key, about 97% with a key list added |
| Item swaps | **Experimental.** The package rewrite is tested structurally (see below) but nobody has yet confirmed the result in game |
| Workshop maps | File replacement is tested; whether a given map loads depends on the file |
| Overlays, profile | Working. The now-playing reader is tested against a real Windows media session (title, artist, cover, pause) and the controller drawing against a real pad; the overlays have not been checked over the running game |
| OpenW Input | **New.** The stick maths matches Steam Input's (measured from the Steam client; tested). The helper reads a DualShock 4 over USB on the test machine, and the virtual controller works. The virtual controller, installing the bundled drivers, hiding (with or without HidHide), rumble, lightbars, Bluetooth, DualSense and Xbox controllers have not been checked yet: the test machine has no ViGEmBus, and Steam held the controller |
| Map Merge | **Experimental.** The arena scan and the file replacement are tested; stadium and whole-arena merges have been checked in game on one or two arenas, not on every pair; built merges are covered by a round-trip test on a real map but not checked in game yet. Same arena every match is checked on one arena; the snowy versions are the game's own arenas |

Fixed in 0.1.1: when the item you own and the new look were encrypted with different keys, 0.1.0 wrote the swapped file with the wrong one and the game crashed when it loaded the item. Swaps and arena changes are now written with the key of the file they replace, and anything 0.1.0 wrote wrongly is rebuilt automatically the next time OpenW runs with the game closed.

Known limits of item swaps in this version:

- **The game must be closed.** If Rocket League is open the swap is queued and applied when you close it; you see it the next time you start the game.
- A swap renames the new look's package to your item's name **in place**, so your item's internal name must not be longer than the new look's (for example Standard boost -> Alpha Reward works, Octane -> Venom does not). On the test machine about half the looks in a category work for a given item. The Garage lists only those once you have picked your item.
- OpenW ships one decryption key, the long-published community one, which opens roughly two thirds of items. The rest show a lock instead of a picture and cannot be used as a new look. If you have a key list (a `keys.txt`, one key per line in hex or base64, as published by community tools), add it under **Settings -> Item pictures and keys**; on the test machine that raised coverage to about 97%. Key lists are not included in this repository.
- Other community tools that swap items the same way report that **car body and goal explosion swaps can crash the game**. Treat those two categories as the riskiest.
- Fixed in 0.4.10: swaps on **default items** (OEM wheels, the Standard boost, Octane, Breakout, Merc and a few more, 21 in all) showed nothing, because the game has those loaded before it ever reads their file (see [How a swap works](#how-a-swap-works)). Swaps of items that keep their look in a group or under a tier name (about 170 items) put the new look where the game never looked. Swaps made with an earlier version are rebuilt the next time OpenW runs with the game closed. **Not checked in game yet.**
- Two player anthems are kept in the game's own program file (TAGame.upk), which OpenW never changes, so they cannot take another look.
- Item names come from the game's own English text file, which needs a key from a key list. With only the built-in key, items are listed under their internal file names (some cars have code names).

Not implemented: custom paint colours, 3D garage preview, custom balls and sounds, stadium colours, and changing your name, title or rank **inside** the game. The last one would need code injected into the running game, which OpenW does not do.

## Install

Download `OpenW-Setup-<version>.exe` from [Releases](https://github.com/Manow17/openw/releases) and run it. It installs OpenW for all users (in Program Files, with Start Menu and desktop shortcuts) and, in the same step, the two controller drivers OpenW Input uses ([drivers/](drivers/README.md)), so Windows' permission prompt for the setup is the only one and the app never shows a driver step. Drivers already on the PC are left as they are. If a driver wants a restart, the setup offers one at the end.

The setup is not code-signed (that needs a paid certificate), so Windows SmartScreen may say it "protected your PC": choose More info, then Run anyway. Uninstall under Windows Settings, Apps; your settings and backups stay in `%APPDATA%\OpenW`, and the drivers stay too, since other apps (DS4Windows, for one) may use them; they have their own entries there.

**Updates.** OpenW updates itself from this repository's releases: shortly after it starts, and every 6 hours, it looks for a newer release, downloads its setup, checks it against the SHA-256 the release gives (GitHub's own digest of the file, or the one in the release notes) and installs it when you close OpenW, or straight away with **Update to v…** at the top. Windows asks for permission once while it installs. It can be switched off under Settings, Updates. A copy run from the source folder never updates itself.

**Releases are built by GitHub Actions** ([.github/workflows/release.yml](.github/workflows/release.yml)). Every push to `main` that changes the app (`src`, `assets`, `bin`, `drivers`, `build` or `package.json`) runs the tests, builds the setup and publishes it as a new release, with its SHA-256 and the commits since the last release in the notes. The version is `package.json`'s when it is newer than every release, otherwise the next patch ([scripts/release-version.js](scripts/release-version.js)). So pushing a change is enough for every installed OpenW to get it.

To build the setup yourself (it lands in `dist/`):

```
npm install
npm run dist
```

## Run it from source

Requires [Node.js](https://nodejs.org) 20 or newer.

```
git clone https://github.com/Manow17/openw.git
cd openw
npm install
npm start
```

To find OpenW from the Windows Start Menu (search for "OpenW"), add a shortcut once:

```
npm run shortcut
```

It starts this copy of the app, so keep the folder where it is. `npm run shortcut -- --remove` takes it away again.

`bin/openw-input.exe` is included. To build it again from `native/openw-input.cpp` (needs the Visual Studio C++ build tools):

```
npm run build-input
```

Run the tests (they copy a few packages to a temp folder and never write to your game):

```
npm test
```

### Merge tester

Checks merged arenas in the game, many at a time, without anyone playing them:

```
npm run merge-test -- --rounds 1
```

Each round merges every standard arena once as the stadium and once as the place (about 60 merges, each arena's place file touched once, so they never collide), restarts Rocket League once (it reads arena files at start), starts BakkesMod, loads each merged arena in Free Play over BakkesMod's RCON (`load_freeplay`), and takes screenshots: kickoff, left, back, right, sky, at a side wall and over it. Each arena gets one contact sheet; `index.html` in `%APPDATA%\OpenW\merge-test\runs\<time>` lists them, the darkest (holes, black sky) first, and `report.json` has the details. `--round 2` uses the next pairing, `--pairs stadium_id:place_id,...` tests chosen pairs, `--mouse` tunes how far the camera turns, `--keep` leaves the last round in place.

It presses keys and moves the mouse in the game window, so run it when nobody is using the PC. Its merges are tracked apart from yours (its own records and backups in `%APPDATA%\OpenW\merge-test`), arenas you changed yourself are left out, and everything it wrote is reverted at the end, after an error too. Needs BakkesMod with its RCON plugin on.

## How a swap works

Each item is a package file such as `WHEEL_Star_SF.upk` whose contents answer to the name `WHEEL_Star`. The game's item list (in `TAGame.upk`) says where each item's look is inside its package, for example `WHEEL_Star.WHEEL_Star`, `boost_bloodshot.FX.boost_bloodshot` or `boost_anime.boost_anime_tier1`. When the item is used, the game looks that path up among the objects it already has, and only when it is not there reads the item's file.

To make item A look like item B, OpenW takes B's package, renames `B` to `A` in its name table, moves B's look to the path A's look has (straight under the package, or into the same group) and writes the result over A's file. Only the encrypted header changes: names are renamed in place (shorter names are padded) and the look's entry in the export table gets another parent, so nothing else in the file moves and the compressed data is never rewritten. A's original file is copied to OpenW's data folder first. The code is in `src/main/core/looks.js`.

**Default items.** The game has some items loaded before their own file is ever read: the OEM wheels are copied into `Startup.upk`, which is always loaded, and the Standard boost, Octane, Breakout, Merc and a few wheels, decals and paint finishes into the main menu's intro scenes (`NUE_CINE_Master.upk`, `MENU_CarSelect_Intro.upk`). Whichever loaded package has an object first wins, so a swapped file for those items would never be read. For them OpenW also gives that early copy of the look object another number on its name (`WHEEL_Star.WHEEL_Star` becomes `WHEEL_Star.WHEEL_Star_1331100000` in `Startup.upk`): the game then misses it and reads the swapped file. Everything else in those packages stays as it was, including the textures other items use, and the scenes that show the copy refer to it by number, not by name. The menu scenes that point to the copy in `Startup.upk` get the same new number. These files are backed up and put back with the swap.

## Project layout

```
src/main/core/   game.js (find game)  upk.js (package reader/patcher)  engine.js (apply, back up, revert, queue)
                 looks.js (where the game finds each item's look; swaps and default items)
                 catalog.js (items)   labels.js (item names)   thumbs.js (item pictures)   arenas.js (map merge, snow)
                 library.js (workshop maps)  store.js (settings)
src/main/        main.js (window, IPC)  preload.js  media.js + media.ps1 (now playing, via Windows)
                 input.js (runs the input helper, drivers, HidHide)
src/shared/      transform.js (OpenW Input's stick and trigger maths and profiles, used by the page and main)
src/renderer/    app.js, styles.css, pad.js (controller drawing), overlay + nowplaying (overlay windows)
native/          openw-input.cpp (the input helper; built to bin/ with `npm run build-input`)
drivers/         the official ViGEmBus and HidHide installers OpenW installs (credits and checksums in its README)
build/           installer.nsh: the setup's extra step that installs those drivers
assets/          app icon (icon-source.webp, turned into icon.png with `npm run icon`), fonts, and
                 controllers/ (MIT drawings, credits in CREDITS.md; rebuilt with `node scripts/prepare-controllers.js`)
test/            core tests
```

## Contributing

Reports of what does and does not load in game are the most useful thing right now. Please include the two items and what you saw.

## License

MIT. The bundled fonts, Outfit and DM Sans, are under the SIL Open Font License (see `assets/fonts`). The controller drawings are MIT-licensed work by the Dracula Theme team and Igor Budzhak (see `assets/controllers/CREDITS.md`). Rocket League is a trademark of Psyonix LLC. This repository contains no game files; the screenshots show item pictures as the app displays them from your own install.
