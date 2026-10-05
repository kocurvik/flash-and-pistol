# Flash and Pištol

A tiny 3D first-person team brawler for the browser: Yellow vs Teal, four characters
(Longman, Builder, Doctor, Spy), best of 5 rounds, two maps. Design: [spec.md](spec.md).

## Play in the browser

**[kocurvik.github.io/flash-and-pistol](https://kocurvik.github.io/flash-and-pistol/)**: nothing to
install; click **Play vs Bots**. Playing with friends needs the local server below.

## Play

**Double-click `play.bat`** (Windows) or run `./play.sh` / `npm start` (macOS, Linux).
This needs [Node.js](https://nodejs.org) (LTS), with no `npm install`. It starts a small local
server and opens the game in your browser. Click **Play vs Bots** and you're in.

Three.js and the add-ons it uses (`vendor/addons`, fetched by `node tools/vendor-three-addons.mjs`)
are bundled, so the game works without an internet connection.

**Graphics** (Settings, or the pause menu): *Low* is the fastest; *Medium* (default) has
smooth edges and sharp shadows; *High* adds soft shadows and glow effects; *Ultra* adds
ambient occlusion and is meant for strong graphics cards. On an Intel UHD laptop GPU at
720p this measured roughly Low 210, Medium 160, High 60 and Ultra 20 FPS.

## Play with friends on the same network (LAN)

1. One person runs `play.bat`. The window prints a link like `http://192.168.1.20:8080`.
2. Everyone else opens that link in their browser. Nothing to install.
3. The host clicks **Host a game**. The game appears under *Games on this network* for
   everyone else, who click **Join**.
4. Players pick a team in the lobby, and the host clicks **Start match**. Bots fill empty slots.

If friends can't connect, allow Node.js through the Windows firewall for *private networks*
(Windows asks the first time). Also check that everyone is on the same Wi-Fi.

## Maps

Pick the map on the main menu; when hosting, the host can change it in the lobby.

- **Arena** (last team standing): an outdoor arena. Eliminate the other team to win the round.
- **Crystal Cave** (capture the treasure): a symmetric cave with chokepoints. Each team guards
  a chest of gems in its base. Walk over the enemy treasure to pick it up, and bring it into
  the ring around your own chest to win the round. A carrier who dies drops the treasure;
  teammates of its owners send it home by walking over it, otherwise it returns after 20 s.
  Everyone respawns 5 s after dying, and can press 1–4 while waiting to switch character.

## Controls

| Action | Key |
| --- | --- |
| Move / look | W A S D / mouse |
| Attack (hold to repeat) | Left click |
| Special: medkit, build tower (hold), throw bottle, steal | Right click or E |
| Jump (Doctor: double jump) | Space |
| Crouch | Shift or C (avoid Ctrl: Ctrl+W closes the tab) |
| Collapse your tower (Builder, standing on it) | Shift + Space |
| Flashlight (Longman) | F |
| Switch weapon | 1 / 2 / mouse wheel |
| Pick character (pick screen, or while respawning in the cave) | 1 – 4 |

All of these except Esc and the pick keys can be changed under **Change controls** on the main
menu, or **Controls** in the pause menu. Each action can have two keys or mouse buttons.
| Scoreboard / menu | Tab / Esc |

## Rules added after playtesting

- **Unstable cloak.** The Spy flickers into view for 0.5 s every 3 s, all round, with
  a shimmer sound. Attacking and stealing also flicker him, as before.
- **Last stand.** When a team has only Spies left, the round clock drops to 45 s and
  enemies see a ping on each Spy through walls. The beeps start 4 s apart and speed up
  (rising in pitch) to 0.5 s apart. Each ping reveals the Spy for longer, and after 30 s he
  is fully visible for good. Spy vs Spy pings both teams. If time runs out, the team with
  more hearts left wins.
- **Tower nail gun.** A Builder standing on his own tower gets a nail gun (left click,
  1 heart, every 0.8 s). Nails only hurt enemies 5–20 m from the tower's base. A ring on the
  ground marks the 5 m blind spot, where nails bounce off. So shoot enemies at range, and
  collapse the tower when they rush inside the ring.

All of these numbers live in `src/config.js`. `node tools/rules-test.mjs` checks them.

## How it is built

No build step: plain ES modules, served as-is.

| File | What it does |
| --- | --- |
| `src/config.js` | **All balance numbers**: characters, weapons, timers, bot difficulty |
| `src/map.js` | Both maps (boxes), spawns, treasure homes, bot lanes |
| `src/physics.js` | Movement, collisions, climbing, ground-pound, raycasts, waypoint graph + A* |
| `src/sim.js` | Authoritative game rules: rounds, picks, combat, steal, towers, bottles, flashlight, treasures and respawns |
| `src/bots.js` | Bot brains: the spec's priority rules + per-character rules |
| `src/models.js` | Meshes: weapons, characters, towers, treasure, arena and cave details, sky and scenery |
| `src/render.js` | Three.js scene, lighting, graphics quality and post-processing, animation, effects |
| `src/hud.js`, `src/input.js`, `src/audio.js` | HUD, keyboard/mouse, synthesized sounds |
| `src/net.js` | Relay connection, host session, client view with interpolation |
| `src/main.js` | Menus, game modes, main loop |
| `server.js` | Zero-dependency static server + WebSocket relay + lobby |

`sim.js`, `bots.js`, `physics.js` and `map.js` have no DOM, so they also run in Node:

```
node tools/headless-test.mjs 10 4 hard   # 10 bot-only matches, prints balance stats
node tools/headless-test.mjs 4 4 normal cave   # the same in the Crystal Cave
node tools/rules-test.mjs                # checks Spy cloak, last stand, nail gun and treasure rules
node tools/relay-test.mjs 8080           # smoke test for the running relay server
node tools/browser-test.mjs <outDir>     # drives headless Chrome, saves screenshots
```

### Multiplayer model

The **host's browser runs the simulation** (including the bots).

- Clients predict their own movement locally, so it feels instant. They send position and
  actions to the host about 30 times per second.
- The host resolves all combat, hearts and rounds, and sends snapshots 20 times per second.
- Clients interpolate other players 100 ms behind.
- If a player leaves, a bot takes over their slot. If the host leaves, the game ends.

## Internet play (planned, not built yet)

The code is set up so this needs no game-logic changes. In order of effort:

1. **Port forwarding.** The host forwards TCP port 8080 on their router. Friends enter
   `<public-ip>:8080` under *Join by address* on the menu. This works today.
2. **Public relay.** `server.js` only forwards messages, so it can be deployed as-is to
   any Node host (Render, Fly.io, Railway, a VPS; it reads the `PORT` environment variable).
   Everyone opens that site, or enters its address under *Join by address*. Behind HTTPS
   the client automatically uses `wss://`. Before doing this:
   - add a room code or password;
   - limit message rates;
   - shrink snapshots (send static fields only when they change).
3. **Peer-to-peer (WebRTC).** Add a `Transport` next to `Relay` in `src/net.js` that uses
   WebRTC data channels. The relay then only does signaling, and game traffic flows directly
   between players. `HostSession` and `ClientView` don't change.
4. **Dedicated server.** Run `Sim` inside `server.js` instead of in the host's browser.
   It has no DOM dependencies. This removes host advantage and makes cheating harder.

## Tuning

Change numbers in `src/config.js` and reload the page. To check the effect quickly,
run `node tools/headless-test.mjs 20` and compare kills and deaths per character.
