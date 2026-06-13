# てのひらの こびと

## 概要
カメラに手をかざすと、てのひらの上に小さな妖精(こびと)が現れて住みつく。手を傾けるとよろよろ歩き、手を閉じると隠れ、もう片方の手の指でつつくと反応する。手の上だけに存在する小さな相棒。

## Concept (EN)
A tiny creature lives on your palm via MediaPipe Hands. It stands on the palm plane, balances when you tilt your hand, slides/stumbles if you tilt too far, hides when you close your fist, jumps between two hands, and reacts to a poke from the other hand's index finger. Camera feed is the background; the sprite is composited in 3D at the palm's estimated position.

## Tech
- MediaPipe Hands (2 hands): 21 landmarks → palm center, palm normal (cross product of landmark vectors), openness
- three.js: low-poly creature (or animated sprite billboard) rendered over the video texture; palm landmarks → world position via simple unprojection at fixed depth
- Procedural animation (lean against tilt, blink, hop) — no rig needed; a few primitives + easing

## Implementation sketch
1. Hand tracking loop → palm pose (position, normal, openness 0..1).
2. Creature state machine: idle / balance / slide / hide (fist) / jump-to-other-hand (when palms near) / poked.
3. Balance: creature's lean angle = smoothed palm tilt; beyond threshold it flails and slides downhill along the palm plane.
4. Tilt your palm toward the camera and it waves back. Feed it: pinch gesture drops a berry that it chases.
5. Stretch: it remembers you with localStorage (name, color) — "your" kobito.

## Why it surprises
The illusion of touch — a virtual being standing on YOUR real hand and obeying its physics. Kids tilt their hands very carefully so it doesn't fall.
