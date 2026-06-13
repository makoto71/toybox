# ゆびさき プラネタリウム

## 概要
真っ暗な画面に指で点を打つと星が生まれ、星と星を線でつなぐと自分だけの星座ができる。完成した星座は光る生き物になって夜空を泳ぎ出す。スマホを動かすと夜空を見回せる（ジャイロ対応）。

## Concept (EN)
A constellation maker. Tap the dark sky to place stars (each gets a twinkle and a faint chime, pitch by height). Drag between stars to draw constellation lines. When you close a shape or hit "complete", the app interprets the line drawing as a creature: the constellation gets a glowing outline fill, eyes appear, and it gently animates (swims/flaps) across a 360° night sky you can look around via device gyro or drag. Your sky fills with personal constellations over time.

## Tech
- three.js: stars as instanced sprites on the inside of a celestial sphere; `DeviceOrientationControls`-style gyro look-around with drag fallback
- Constellation→creature: no ML needed — animate the line graph itself (per-vertex sine ripple along the path), add procedural eyes at the 2 highest-degree nodes, subtle whole-shape drift. Ambiguity is a feature (it looks dreamlike)
- Web Audio for the star chimes (pentatonic, like everything good)
- Persistence: constellations in localStorage; background Milky Way as a generated noise texture

## Implementation sketch
1. Sky dome + gyro/drag camera. Tap raycasts to sphere → spawn star sprite + chime.
2. Line drawing: drag from star to star creates a glowing segment (additive, slight pulse).
3. "できた！" button: group the graph, apply ripple animation + slow orbit, blink-open eyes after 1s.
4. Naming: optional text input ("〇〇ざ" suffix auto-added), shown as faint serif label when looked at.
5. Stretch: real-star mode — overlay actual bright stars/planets for tonight's sky (small static catalog, no API needed) and let kids draw their own constellations over real stars.

## Why it surprises
The moment a scribble of lines opens its eyes and swims away as "your" constellation. Quiet, bedtime-friendly counterpart to the louder toys.
