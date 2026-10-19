# TSUNAMI — endless giant wave

An arcade big-wave surf game for the web, built with vanilla Three.js + Vite.
Every level is a **procedurally generated, infinite tsunami**: an endless train
of colossal waves rolling downhill forever, surfaced with a poseidon-grade
water shader. The wave face *is* the mountain — terrain-aware gravity drives
the board, so dropping down a 40 m face rockets you forward and climbing one
bleeds speed, exactly like snowboarding. Pick a break from the level menu
(with live wave previews), carve, spin and flip for points, and chase the
distance — there is no finish line.

Game code is original; `src/game/poseidon/` vendors two MIT modules from the
Poseidon ocean demo (poseidon-src/) — the measured Jerlov water-optics tables
and the baked detail-noise texture — and `tools/glslang/` vendors the Khronos
glslang wasm build used by `npm run shaders`.

The surfer models in `public/models/surfers/` come from the SURF SPACE game
(reference/surf_tricky — MIT per its README; the models are skinned rigs with
their own animation libraries, surfboards and beachwear included). Tux is our
own build from the GPL-2.0 Extreme Tux Racer model, per surf_tricky's docs.

`public/models/rigs/` and `src/game/RiggedChars.js` come from the sibling
surfmechanics project (public domain / MIT per its README): two UNRIGGED
models — an anatomical skeleton and a human body — plus a 25-bone Mixamo rest
rig carrying 28 surf clips. The module auto-rigs the models against that rig
at load time; the port to this project swaps three/webgpu node materials for
plain WebGL ones and adapts the animator to this game's rider state.

## Run

```bash
npm install
npm run dev
```

## Controls

- `↑` `↓` / click — pick a break in the menu (the water behind the panel IS
  the level, previewed live) · `SPACE` / `ENTER` — drop in
- `←` `→` / `A` `D` — carve
- `SPACE` — jump
- in the air: `←` `→` spin · `↑` `↓` backflip / frontflip
- `C` — cycle camera angle: chase · low · front · side · orbit
- `L` — wave select (reopens mid-run; the run keeps surfing behind it)
- `M` — settings: pick your surfer (CHAD · ZOE · MARILYN · TUX · KAI · BONES),
  swaps live
- land clean to bank the trick; land sideways/upside-down and you wipe out

## The levels

Ten seeded breaks plus a re-rolling RANDOM REEF, each an endless analytic
wave field with its own giant (amplitude / wavelength / speed / crest
sharpening / double-up stacks), its own sky (painted cosmos panorama), sea
palette (Jerlov-tinted body colours), moon placement and foam mood:

| break | face | character |
|---|---|---|
| MAVERICK | ~58 m | the classic giant — steep drops, long walls |
| FIRST LIGHT | ~24 m | mellow dawn rollers — learn the face |
| TEAHUPOO | ~43 m | thick lips, heavy, blood-tide sky |
| JAWS | ~76 m | big, fast and long |
| NAZARÉ | ~105 m | the biggest water on earth |
| PIPELINE | ~25 m | quick pitchy peelers |
| CORTES BANK | ~56 m | long-period open-ocean walls |
| SHIPSTERN | ~44 m | stepped double-up sets |
| DUNGEONS | ~54 m | cold black water |
| GOLDEN HOUR | ~36 m | bronze glass, endless glitter road |

## Architecture

```
src/
  main.js            entry
  game/
    Game.js          renderer, scene, camera rig, scoring + level flow
                     (applyLevel swaps wave/sky/light/water live)
    Levels.js        the procedural generator: archetypes + seeds -> wave
                     params, sea palettes, sky presets, shader look constants,
                     menu stats. RANDOM REEF re-rolls a fresh seed per visit
    LevelMenu.js     the level select overlay (keyboard/click, live preview)
    Waves.js         the analytic giant-wave field: a phase-warped tsunami
                     train (steep drop-in face, gentle back) + swell/chop/
                     ripple texture, with exact analytic gradients — JS for
                     physics, generated GLSL for the GPU, one params object
                     so they stay in sync by construction. No run bounds:
                     the field is infinite and the world chases the rider
    Rider.js         arcade board physics: carve, jump, spin/flip, trick eval.
                     Gravity is projected onto the giant's face (the wave is
                     the mountain); the pull is capped under the board's
                     drive so no wall is a trap
    Slope.js         the water, horizon to horizon: a ~850k-vertex
                     non-uniform grid (0.6 m cells under the rider, doubling
                     rings out past the 3 km sky dome) that chases the rider,
                     displaced on the GPU and shaded with a GLSL port of the
                     poseidon ocean model (dielectric Fresnel sky reflection,
                     Jerlov-diffusion subsurface scatter, GGX moon glitter,
                     cellular foam). The giant drives its own looks: thin lit
                     upper faces, emerald lips (path length scales with wave
                     size), crest-gated whitewater
    Cosmos.js        per-level painted cosmos panorama (seeded nebulae, star
                     fields, the moon at the level's light direction),
                     seam-wrapped equirect + twinkling point layer
    Characters.js    the surfer roster + GLTF loading + the animation state
                     machine (idle / carve / jump / tricks / wipeout).
                     Riders flagged `rigged` are handed to RiggedChars.js
    RiggedChars.js   the two auto-rigged riders (KAI, BONES), ported from
                     surfmechanics: a shared 25-bone rest rig is folded into
                     each model's own stance (measured off the geometry for
                     the skeleton), vertices are weighted by distance to the
                     bone segments, and the 28-clip surf library then plays
                     back untouched. Carries its own board, stance
                     calibration (soles on the deck, per-clip settle) and
                     animator, behind the same CharacterRig interface
    Settings.js      the settings overlay (M): live character selection
    Crystals.js      crystal formations pooled over the endless field
    poseidon/        vendored from poseidon-src (MIT): Jerlov water optics
                     (water.js) + the baked detail-noise texture
    Spray.js         pooled carve spray particles
    Hud.js           DOM score / speed / distance / wave / trick popups
    Input.js         keyboard with press edge-detection
```

## Checks

- `npm run shaders` — compiles every level's water shader pair through
  Khronos glslang (vendored in `tools/glslang`), so a shader edit or a level
  generator change is validated without opening a browser
- `npm run wavetest` — verifies the analytic band gradients against finite
  differences of the height field for every level, and that the steepest
  terrain stays inside the board's drive budget (no trap walls)
- `npm run oceantest` — verifies the water grid (extents, dense spacing) and
  that the aerial perspective fully dissolves the surface before the sky dome
  crosses it, so the ocean has no visible edge
- `npm run steertest` — control directions, plus terrain gravity: drops
  accelerate, climbs decelerate, and a standstill climb always crests
- `npm run camtest` — camera rig geometry per mode + water/bounds guards
- `npm run chartest` — verifies every animation clip the roster references
  exists in its character GLB, and for the auto-rigged pair that the shared
  clip library still carries every clip and bone the rigger names, and that
  each source model still has the meshes its part map pins to bones
- `node levelshots.mjs` — optional visual sweep (needs the puppeteer install
  under `reference/surf-game/`): boots the preview build, rides each break
  and saves screenshots to /tmp/tsunami

## Roadmap

- rails / grinds with slide + balance scoring
- boost meter, grab tricks, combo multiplier
- gamepad + touch controls
- breaking-lip chase cam + barrel sections on the heavy breaks
- per-level score memory

## Note on the reference game

`renderfiction_tricky/` contains a locally saved copy of a third-party web game
kept for personal gameplay study only. It has **no open-source license**, so it
is deliberately not part of this project and nothing is copied from it.
Gameplay *mechanics* (carving, spins, trick scoring) are ideas, not copyright,
and this project re-implements them from scratch.

## License

TSUNAMI is **GPL-2.0** (see `LICENSE`) because it includes a GPL-2.0 Tux model.
Third-party components are listed in `THIRD_PARTY.md`; the Tux asset must remain
under GPL-2.0.
