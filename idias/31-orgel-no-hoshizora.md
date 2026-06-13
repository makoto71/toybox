# オルゴールの ほしぞら

## 概要
よぞらに、じぶんの「おと」を星としてはりつけられる。ボタンをおして「ポン」と手をたたけば手拍子の星、「にゃー」と言えばねこの星。空にはすい星がぐるぐる回っていて、星のそばを通るたびにその音が鳴る。星のならべかたを変えると曲が変わる——よぞら全体がじぶんだけのオルゴールになる。

## Concept (EN)
A celestial music box / spatial sequencer. Record tiny sounds (claps, words, meows, cup taps) — each becomes a glowing star you place on the night sky. Comets orbit on concentric rings with different periods; when a comet sweeps past a star, the star flares and plays its sound. Because ring periods differ (1×, 1.5×, 2×), arrangements produce polyrhythmic, ever-evolving loops — a Tenori-on made of your own voice, drawn as constellations.

## Tech
- Audio: hold-to-record ≤ 2 s clips → `AudioBuffer` (MediaRecorder → `decodeAudioData`, or capture raw via AudioWorklet). Playback through one `AudioContext` graph: per-star `AudioBufferSourceNode` → panner (star azimuth → stereo pan) → master compressor + a hall reverb (`ConvolverNode`, small baked IR) so any junk sound becomes pretty.
- Optional pitch quantize: detect the clip's dominant pitch (autocorrelation) and offer "snap to pentatonic" — playbackRate multiplied by the ratio to the nearest scale note. Pentatonic guarantees harmony between random sounds.
- Scheduling: look-ahead scheduler (the standard Web Audio "tale of two clocks" pattern): every 100 ms, schedule all star-passes occurring in the next 300 ms at exact `AudioContext.currentTime` offsets. Comet angular position is deterministic from time → trigger time solvable analytically per star (no per-frame polling drift).
- Visuals: three.js sky dome, additive star sprites with bloom flare on trigger, comet = particle-trailed point. Drag stars between rings / along rings to recompose; pinch a star to change its size = volume. Gyro look-around (reuse the planetarium idea's control style).
- Persistence: serialize each buffer to 16-bit WAV (few hundred KB) + positions into IndexedDB; shareable export = render the mix offline via `OfflineAudioContext` → WAV/WebM download.

## Implementation sketch
1. One ring, one comet, tap-to-place pre-baked sounds — validate the scheduler and the trigger flare feel.
2. Recording flow with a friendly "catch a sound in the jar" animation; auto-trim silence (RMS gate) and normalize.
3. Add 3–4 rings with period ratios (e.g. 4:6:8:3 beats) + tempo slider (ring angular speeds scale together).
4. Pentatonic snap toggle; per-ring instrument color.
5. IndexedDB save slots ("my songs"); OfflineAudioContext bounce → share.
6. Stretch: shooting-star randomizer (occasionally triggers a random star = generative sparkle); shake to scatter stars into a new arrangement.

## Pitfalls
- Mic clips arrive with leading silence and DC offset → trim + highpass at 60 Hz on import.
- Many simultaneous triggers can clip → per-star gain ducking under a master `DynamicsCompressorNode`.

## Why it surprises
Sequencers intimidate; skies don't. Kids understand "put the star where the comet will find it" instantly, and the polyrhythmic rings mean even random placement sounds like ambient music (pentatonic snap removes the last way to fail). The first time a child hears their own "にゃー" orbiting in harmony with their clap, the toy becomes theirs.
