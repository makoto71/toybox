# ことばのあめ

## 概要
マイクに話しかけると、しゃべった言葉が3Dの文字になって空から降ってくる。積み上がった文字は手で押したり崩したりできる。自分の言葉が「もの」になる不思議な体験。

## Concept (EN)
Spoken words materialize as chunky 3D characters (hiragana/kanji) that rain down with physics, bounce, and pile up on the floor. Words spoken louder fall as bigger, heavier letters. You can sweep them away with your hand (via camera hand tracking) or tilt the floor (device orientation) to pour them off. Saying「ゆき」makes the letters white and slow-falling; magic words (あめ, ほし, はな) trigger themed effects.

## Tech
- Web Speech API (`SpeechRecognition`, `lang: 'ja-JP'`, interim results) — works on Chrome/Edge/Safari
- three.js + a physics engine (rapier.js WASM or cannon-es); box colliders per character are enough
- Text geometry: `TextGeometry` with a bundled Japanese subset font is heavy — better: render each char to a canvas texture on an extruded rounded box, or use troika-three-text + simple box collider
- Optional MediaPipe Hands for swatting letters

## Implementation sketch
1. Speech recognition → on result, split into characters, spawn them above the viewport with slight scatter.
2. Each char: rounded-box rigid body, canvas-texture face showing the glyph, color from a per-word palette.
3. Magic-word table: {ゆき: snow shader + white letters, ほし: letters become stars and float up, etc.} — easily extensible JSON.
4. Floor tilt from `deviceorientation` on mobile; desktop gets mouse-drag wind.
5. Stretch: hand-tracking broom mode; "poem mode" that freezes the pile and screenshots it.

## Why it surprises
Speech→physical object is still magical, and the magic-word easter eggs make kids keep talking to it, experimenting with vocabulary.
