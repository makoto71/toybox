# ひかる プランクトンの うみ

## 概要
真っ暗な夜の海。指で水面をなぞると、夜光虫(ひかるプランクトン)が青白く光って渦を巻く。スマホを傾けると光の群れが流れ、声を出すと海全体がぼんやり明滅する。実在する「光る海」の現象を再現した、癒し系メディアアート。

## Concept (EN)
Bioluminescent sea. Millions of plankton particles drift in a dark fluid; agitation makes them glow. Finger strokes inject velocity into a fluid field — plankton caught in the flow light up cyan-blue and fade over seconds, leaving glowing eddies and vortex trails. Tilt adds a global current; sound (voice/music via mic) raises a gentle ambient pulse across the whole sea. Occasionally a dark fish swims through, leaving a luminous wake.

## Tech
- 2D fluid sim on GPU (stable fluids: advect/diverge/pressure passes in fragment shaders — well-trodden, ~200 lines of GLSL)
- GPGPU plankton particles (≥500k) advected by the velocity field; per-particle excitation = recent |velocity| → emission with exponential decay
- Rendering: additive points with soft sprites + bloom (cheap: downsample blur); subtle background gradient + star reflections
- Inputs: pointer → velocity splat; DeviceOrientation → constant force; mic RMS → ambient excitation term

## Implementation sketch
1. Fluid passes at 256×144 — plenty for organic swirls; particles sampled bilinearly from it.
2. Excitation: `glow = max(glow*decay, k*|vel|)`; color ramp deep-blue → cyan → white at peak.
3. The fish: a scripted spline swimmer that injects a moving velocity splat (gorgeous wake for free).
4. Calm-down design: no score, no goal; optional ambient audio generated with Web Audio (filtered noise waves).
5. Stretch: long-exposure mode — accumulate glow into a texture and save the swirl painting as PNG.

## Why it surprises
It feels alive and reactive at a level UIs never are — the fluid eddies keep glowing and curling after you lift your finger. Doubles as a genuinely beautiful "calm app" for bedtime.
