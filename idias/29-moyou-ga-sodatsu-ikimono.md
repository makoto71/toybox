# もようが そだつ いきもの

## 概要
画面の中に、まっしろなふしぎな生きものが一匹すんでいる。ごはんをあげたり、なでたりすると、体の表面にヒョウ柄・しまうま柄・サンゴ模様がじわじわと「生えて」くる。模様は本物の生き物と同じ数式(チューリング・パターン)で育つので、二度と同じ柄にはならない。毎日せわをすると柄がどんどん複雑になる、模様ペット。

## Concept (EN)
A virtual pet whose only growth axis is its *skin pattern*, driven by a real reaction–diffusion simulation (Gray–Scott / Turing patterns — the same mathematics believed to pattern leopards and zebrafish). Feeding shifts the local chemistry toward spots; petting strokes seed stripes along your finger path; leaving it alone lets mazes creep. The pattern is genuinely emergent: no two pets ever match, and the pattern keeps living even while you watch.

## Tech
- Sim: Gray–Scott reaction–diffusion in a ping-pong float FBO (256–512²), ~10 sim steps per frame in a fragment shader. The (F, k) parameter pair selects the regime (spots / stripes / mazes / mitosis); store F and k as a *spatial map* texture so different body regions can grow different patterns.
- Interaction → chemistry: feeding tap splats a (F,k) blob in the "spots" regime + seeds chemical V; petting drag writes an anisotropic diffusion direction (stripes follow stroke direction — implement via a 2×2 diffusion tensor per pixel, or cheaper: elongated seed splats); ignoring slowly relaxes (F,k) toward the "maze" regime.
- Creature: a soft blob mesh in three.js (sphere with vertex-noise wobble + squash-and-stretch idle animation); the RD texture maps onto it with a 2-color gradient ramp (pattern color drifts with "mood"). Eyes/mouth are separate billboards that track the pointer.
- Persistence: dump the RD state texture (`readPixels` → compressed via canvas PNG) + (F,k) map into IndexedDB on exit; restore on load — the pet "remembers" its coat. Days-since-birth stat from a stored timestamp.
- Mood: every ~5 s, read back a tiny 64² downsample on CPU, count pattern blobs/stripes (threshold + connected components) → drives animation set (spotty = bouncy, stripey = sleek slinks, maze = sleepy).

## Implementation sketch
1. Gray–Scott on a flat quad with mouse seeding — tune the (F,k) presets until each regime is reliably reachable.
2. Wrap onto the blob mesh; add idle animation + eye tracking (cheap charm, huge effect).
3. Implement feed / pet / ignore → (F,k) map edits. Clamp the map so the sim never dies out or explodes (keep within the known stable band).
4. IndexedDB save/restore; birthday counter; "patterns so far" photo album (auto-snapshot when pattern statistics shift sharply).
5. Stretch: breed mode — two saved pets' (F,k) maps blended produce a child; pattern-to-sound (stripe density → purr pitch).

## Pitfalls
- RD needs float textures: require WebGL2 / `EXT_color_buffer_float`, with a half-float fallback.
- Gray–Scott can flatline if V dies everywhere → watchdog: if total V < ε, auto-seed a few specks ("the pattern sneezed").

## Why it surprises
Tamagotchi taught kids to feed a pet; this pet *visibly grows its fur pattern in real time* using honest biology-grade math. Watching spots split like cells (the mitosis regime) is mesmerizing, and "my one is the only one in the world with this coat" is a powerful ownership hook. Quietly the deepest science content in the whole toy box.
