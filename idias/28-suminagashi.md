# すみながし — みずに ながす もよう

## 概要
画面いっぱいに張られた静かな水面。指でちょんと触れると墨のしずくが落ち、同心円の輪がふわりと広がる。息を吹きかければ墨が流れ、スマホを傾ければゆっくり渦を巻く。最後に「紙をのせる」と模様が和紙に写しとられて、世界に一枚だけのマーブル紙が保存できる。日本の伝統「墨流し」のデジタル再現おもちゃ。

## Concept (EN)
Suminagashi / paper marbling on a GPU fluid. Tap to drop ink (alternating ink/clear concentric rings, like the real technique of touching the surface with two brushes), drag a virtual stylus to draw combs and feathers through the rings, blow into the mic to push the ink, tilt the device for slow gravity drift. Then "lay the paper": the pattern transfers onto washi with a satisfying wipe animation and saves as a PNG. Meditative, gorgeous, zero permissions required (mic/tilt optional).

## Tech
- Fluid: standard stable-fluids solver in WebGL ping-pong FBOs (velocity 256–512², pressure Jacobi ~20 iter), same family as the well-known WebGL-Fluid-Simulation. Key difference from a smoke toy: very low velocity dissipation, **zero dye diffusion**, and dye advected at 2× resolution with MacCormack/BFECC advection so ink boundaries stay razor sharp (the marbling look lives or dies on crisp edges).
- Ink drop: write alternating annuli into the dye texture + small radial divergence impulse so existing rings push outward (real suminagashi rings displace each other — this is what makes layered taps look authentic).
- Surfactant trick: two-finger tap = "alcohol drop" → strong radial outflow clears a hole, shoving ink into delicate filaments.
- Mic blow: low-frequency energy from `AnalyserNode` → directional force from screen bottom (or from tap-anchored direction). Tilt: `devicemotion` gravity vector → small uniform body force.
- Paper transfer: composite dye over a washi paper texture with fiber-following slight displacement (curl noise), vignette, then `canvas.toBlob` → download / Web Share API.

## Implementation sketch
1. Stand up the fluid sim with dye + sharp advection; verify a dragged pointer makes clean swirls.
2. Implement ring-drop brush (N alternating annuli, N grows the longer you hold). Add the outward displacement impulse.
3. Stylus tool: a thin "rake" — pointer drag applies a narrow velocity ribbon; add a multi-tine comb tool (classic marbling patterns: nonpareil, feather) as parallel offset ribbons.
4. Tilt + blow forces; calm auto-damping so the surface always settles back to stillness.
5. Paper-lay ceremony: freeze sim, animated paper sweep, save. Gallery on localStorage.
6. Stretch: color mode (traditional sumi black + indigo + vermilion palette), and a "print onto a 3D fan/bookmark" three.js viewer.

## Pitfalls
- Dye bleeding into gray mush = dead toy → no diffusion, sharp advection, store dye as float16, and re-sharpen with a mild contrast curve in the display shader.
- Phones throttle: drop pressure iterations before resolution; the aesthetic tolerates an imperfect solve.

## Why it surprises
Real marbling is a one-shot artform requiring trays and chemicals; here a child layers fifty rings, blows on the water, and pulls a museum-grade print — then does it again. The alternating-ring brush makes literally any random tapping look intentional and beautiful, which is the secret of the toy: you cannot fail.
