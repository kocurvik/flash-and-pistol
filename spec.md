# Flash and Pištol — Game Design Spec

Oct 3, 2026 · @Viktor Kocur

## Overview

Flash and Pištol is a 3D, first-person team brawler in the spirit of Team Fortress 2, with only four characters: Longman, Builder, Doctor and Spy. Two teams, Yellow and Teal, fight in a small arena; a team wins a round by eliminating every enemy. It runs in a web browser and is fully playable offline against bots.

Core loop: pick a character → fight in the arena → when you die, wait for the round to end → pick again (same or different character) → next round.

**Designer's ideas (from the dictation):** the game concept, 3D, two teams Yellow and Teal, win by killing all enemies, all four characters and their weapons and abilities, health measured in hearts, the Spy being invisible all game, and the rule that a dead Spy's player may pick another character or risk the Spy again.

**Filled in for this spec:** exact numbers, round structure, the Spy's attack, backup weapons for Builder and Doctor, controls, map, bot behavior and the tech stack. Every filled-in item is marked *(assumption)* so it can be changed easily.

## Game rules

A match is best of 5 rounds; a round ends when one team has no living players *(assumption)*. On the Crystal Cave map the rules are different: see [Crystal Cave: capture the treasure](#crystal-cave-capture-the-treasure).

- **Teams:** Yellow and Teal, 4 players each by default. Bots fill any empty slot. Team size is configurable from 1 to 6.
- **Hearts:** health is counted in whole hearts. Every hit removes or restores whole hearts, so it is easy to read. Max hearts depend on the character.
- **Character pick:** at the start of each round, every player picks a character. Duplicates are allowed, but at most 2 of the same character per team *(assumption)*.
- **Death:** a dead player becomes a spectator until the round ends, then picks again. This is how the designer's Spy rule works: a dead Spy's player can switch to someone else or risk picking Spy again.
- **Round timer:** 3 minutes. If it runs out, the team with more total hearts left wins the round *(assumption, prevents endless hiding)*.
- **Friendly fire:** off. Hitting a teammate only matters for the Doctor's healing axe.

## Characters

Each character has one primary weapon, one backup weapon and one special. All numbers are starting values for playtesting.

| Character | Role | Hearts | Speed (m/s) | Primary | Backup | Special |
| --- | --- | --- | --- | --- | --- | --- |
| Longman | Tank | 6 | 4.0 | Machete | Dagger | Medkit, flashlight |
| Builder | Area control | 4 | 5.5 | Wrench | Fists *(assumption)* | Collapsing tower |
| Doctor | Healer | 4 | 7.2 | Axe | Kick *(assumption)* | Healing bottle |
| Spy | Thief / assassin | 3 | 6.5 | Fists | none | Invisibility, steal weapon |

### Longman

Slow and tough, Longman holds the front line and hunts Spies.

- **Machete (primary):** melee swing, 2 hearts damage, 0.8 s between swings.
- **Dagger (backup):** used when a Spy steals the machete. 1 heart damage, 0.4 s between swings.
- **Medkit:** heals himself 2 hearts. Recharges after 20 s *(assumption)*.
- **Flashlight:** toggle on/off. Any Spy inside its beam (10 m cone) becomes visible as a glowing outline *(assumption: this gives the flashlight a purpose and gives teams a Spy counter)*.

### Builder

The Builder controls space with towers that turn into traps.

- **Wrench (primary):** a spin attack swung around the head. Hits every enemy within 2 m for 2 hearts, 1.2 s between spins.
- **Fists (backup):** 1 heart damage, used if the wrench is stolen. Towers cannot be built without the wrench.
- **Collapsing tower:** hold the build key for 2 s to build a 3 m tall tower in front of you. Only one tower at a time. The Builder can climb it and use it as a lookout. When he jumps down hard onto its top (crouch + jump while standing on it), the tower collapses: every enemy within 3 m of its base loses 4 hearts, and the Builder loses 1 heart. New tower available 25 s after a collapse.

### Doctor

A robot doctor on two regular legs. Healing is its main job.

- **Movement:** walks and runs normally (no hopping), is the fastest character and has a double jump, so it is good at reaching teammates.
- **Axe (primary):** hitting a teammate heals them 1 heart. Hitting an enemy removes 1 heart. 0.7 s between swings.
- **Healing bottle:** thrown like a grenade. On impact it splashes and heals all teammates within 2.5 m by 2 hearts (the Doctor too). Recharges after 15 s.
- **Kick (backup):** 1 heart damage, used if the axe is stolen. The bottle still works.
- Heals cannot go above a character's max hearts.

### Spy

Invisible for the whole game, but fragile. Strong when used cleverly, risky to pick.

- **Invisibility:** always on. The Spy briefly flickers into view for 1 s after attacking or stealing, and Longman's flashlight reveals him *(assumptions for balance)*.
- **Steal weapon:** at melee range, press the steal key on an enemy. Their primary weapon is taken for the rest of the round and they switch to their backup. It never takes the backup, as the designer specified. 8 s cooldown.
- **Using stolen weapons:** the Spy can use the last weapon he stole instead of his fists *(assumption: makes stealing rewarding)*.
- **Fists:** the Spy starts with only his fists: 1 heart damage, 0.5 s between punches, no backstab bonus. Stealing is how he gets a real weapon.
- Spies cannot steal from other Spies.

## Balance notes

Every character beats one other and loses to another, so no single pick is always best.

| Character | Strong against | Weak against | Why |
| --- | --- | --- | --- |
| Longman | Spy | Builder | Flashlight reveals Spies and 6 hearts outlast his punches; but he is too slow to escape a tower collapse. |
| Builder | Longman, groups | Doctor, Spy | Tower collapses punish slow or clustered enemies; a fast, double-jumping Doctor dodges, and a Spy can steal the wrench. |
| Doctor | Builder, long fights | Spy | Healing wins drawn-out fights; but 4 hearts and a predictable heal target make it a Spy's favorite victim. |
| Spy | Doctor, Builder | Longman | Invisible thief who cripples key players; only 3 hearts, so one good machete hit nearly kills him. |

- **The Spy risk:** the designer wanted picking Spy again to feel risky. With 3 hearts and a hard counter (flashlight), a careless Spy dies early and sits out the round.
- **Main tuning knobs:** Spy flicker time, flashlight range, tower damage and cooldown, Doctor heal amounts. Change these first if a character feels too strong or weak.

## Crystal Cave: capture the treasure

A second map, picked on the main menu (or by the host in the lobby). It comes with its own mode.

- **Map:** a symmetric cave, about 72 × 36 m with a 7 m ceiling. Each base is a torch-lit chamber with the team's treasure in an open chest. A base opens through two 3 m doors into side lanes. The side lanes reach the crystal-lit middle cavern through three chokepoints: two 3.5 m gaps and a low tunnel in the center. The middle cavern has a raised rock platform and four floor-to-ceiling columns.
- **Treasure:** each team's "flag" is a heap of gems in its team color. An enemy picks it up by walking over it. The gems float above the carrier's head, and a Spy carrying them stays visible.
- **Dropping:** when the carrier dies, the treasure drops where they fell. A teammate of its owners who walks over it sends it straight home; otherwise it goes home on its own after 20 s *(assumption)*.
- **Winning a round:** carry the enemy treasure into the ring around your own team's chest. Your own treasure does not have to be at home *(assumption: avoids stalemates)*. A match is still first to 3 rounds.
- **Respawning:** everyone respawns in their base 5 s after dying. While waiting, a player can press 1–4 to come back as a different character, which keeps the designer's Spy rule. A player who joins mid-round picks a character and spawns right away.
- **Round timer:** 5 minutes. If nobody captures a treasure, the round is a draw *(assumption)*. The last stand rule does not apply, since nobody stays dead.
- **Bots:** half of each team attacks and half defends; Builders always defend and Spies always attack. Any bot carrying the treasure runs home, defenders hunt the enemy carrier, nearby bots return a dropped treasure, and any bot close to the enemy treasure grabs it.

## Map, controls and HUD

The Arena: one symmetric arena about 60 × 40 m, built from simple boxes *(assumption)*.

- **Layout:** Yellow base at one end, Teal base at the other, an open middle field, and two side lanes marked by low cover walls. Crates, pillars and waist-high walls give cover. A raised walkway in the middle rewards Doctor double jumps and Builder towers.
- **Look:** flat colors, no textures. Characters are built from boxes and cylinders, tinted yellow or teal. Each character has a clear shape: Longman tall and thin, Builder wide, Doctor a metal robot, Spy small.

| Action | Key |
| --- | --- |
| Move | W A S D |
| Look | Mouse |
| Jump | Space |
| Crouch | Ctrl |
| Attack | Left click |
| Special (medkit, build tower, throw bottle, steal) | Right click |
| Flashlight (Longman) | F |
| Switch weapon | 1 / 2 |
| Scoreboard | Tab |
| Pause | Esc |

**HUD:** hearts in the bottom left, current weapon and special cooldown in the bottom right, crosshair in the center, round score and timer at the top, and a small kill feed in the top right. In the Crystal Cave, each treasure's status (at home, taken by whom, or dropped) shows under the score, and the respawn countdown shows while dead.

## Bot behavior (offline play)

Bots use a simple priority list checked about 5 times per second: they do the first rule that applies. No pathfinding library is needed; the map has a hand-placed grid of waypoints.

**Shared rules (all bots):**

1. If hearts are low (≤ 1) and a friendly Doctor is alive, move toward the Doctor.
2. If a visible enemy is within attack range, face it and attack.
3. If a visible enemy is within 20 m, move toward it via waypoints.
4. Otherwise, walk toward the enemy base along a random route, so bots spread out.

**Character rules (checked before the shared rules):**

- **Longman bot:** uses the medkit at ≤ 3 hearts. Turns on the flashlight when hit by something it cannot see, and sweeps it around.
- **Builder bot:** builds a tower near a waypoint enemies often pass. When 2 or more enemies are within 3 m of its tower, climbs up and collapses it.
- **Doctor bot:** follows the most injured teammate and swings the axe at them until healed. Throws the bottle when 2 or more teammates are hurt and close together. Only fights when nobody needs healing.
- **Spy bot:** sneaks along the side lanes toward the enemy Doctor or Builder, steals their weapon, then attacks from behind with it. Retreats from any lit flashlight.

**Difficulty:** Easy, Normal and Hard change reaction delay (0.8 / 0.4 / 0.2 s), aim wobble and how often bots use specials. Bots cannot see an invisible Spy unless he is flickering or in a flashlight beam, the same as players.

## Technical implementation

The game is a single `index.html` file using Three.js, with no build step and no server. Open it in a browser and play.

- **Rendering:** Three.js loaded from a CDN for development. For true offline use, save `three.module.min.js` next to `index.html` and import it locally.
- **Input:** Pointer Lock API for mouse look, standard keyboard events.
- **Physics:** no physics engine. Characters are capsules colliding against axis-aligned boxes (the map is all boxes), plus simple gravity. Melee hits are a cone check: target within range and within ±40° of the facing direction.
- **Invisibility:** the Spy's mesh is hidden; during flicker or flashlight it is drawn with a transparent glowing material.
- **Data-driven characters:** all numbers from the Characters section live in one `CHARACTERS` object at the top of the file, so balance changes need no code edits.
- **Game loop:** fixed 60 Hz update for movement, combat and bots; rendering runs at the display rate.
- **Code structure:** `Game` (rounds, score, timer) → `World` (map boxes, waypoints) → `Entity` (position, hearts, team, weapons) with player input or a `BotBrain` driving it. The same `Entity` class serves humans and bots, which makes multiplayer easier later.
- **Audio (optional):** short sounds made with the Web Audio API, so no sound files are needed. Spy footsteps should be audible but quiet.

**Later multiplayer path:** add a small Node.js WebSocket server that runs the same game loop, with browsers sending inputs and receiving positions. Not needed for version 1.

## Build milestones

Each step ends with something playable, so the designer can test and give feedback early.

1. **Walk around:** the arena, first-person movement, jumping, collisions.
2. **Fight a dummy:** Longman with machete and hearts; a standing target that loses hearts.
3. **Simple bots:** shared bot rules; 1 vs 1 Longman fights, round win and restart.
4. **All four characters:** weapons, specials, stealing and backup weapons, healing.
5. **Full match:** 4 vs 4 with bots, character pick screen, best of 5, HUD and scoreboard.
6. **Polish:** character-specific bot rules, difficulty levels, sounds, balance tuning.

**Ideas for later:** more maps, a third-person camera option, local split-screen, online multiplayer.

## Zhrnutie po slovensky

Hra sa volá Flash and Pištol. Je 3D a podobá sa na Team Fortress 2. Bojujú dva tímy, **žltý** a **tyrkysový**. Kto zabije všetkých nepriateľov, vyhrá kolo. Hrá sa v prehliadači a dá sa hrať aj bez internetu proti botom.

- **Longman:** pomalý, ale silný (6 srdiečok). Má mačetu, dýku, lekárničku a baterku. Baterkou vie nájsť neviditeľného Spya.
- **Staviteľ:** kľúčom sa točí okolo hlavy a zasiahne všetkých okolo. Postaví vežu, skočí na ňu, veža sa zbúra a zraní nepriateľov pod ňou. Jemu to zoberie 1 srdiečko.
- **Doktor:** robot s vtáčou nohou, skáče. Sekerou lieči svojich a nepriateľom berie srdiečka. Fľašou oblieva a lieči spoluhráčov.
- **Spy:** neviditeľný celú hru, ukradne nepriateľom hlavnú zbraň. Má len 3 srdiečka, takže je to riskantné.

Keď ťa zabijú, počkáš do konca kola a potom si vyberieš postavu znova.
