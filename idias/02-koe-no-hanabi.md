# こえのはなび

## 概要
マイクに向かって声を出すと、声の大きさ・高さ・長さに応じた花火が夜空に打ち上がる。「わーーー！」と叫ぶと大輪、ささやくと線香花火。声がそのまま光になる、音と映像のメディアアート。

## Concept (EN)
Voice-driven fireworks. Loudness controls burst size, pitch controls color (low=red/orange, high=blue/violet), vowel timbre (spectral centroid) controls burst shape (peony / willow / ring / crackle). Sustained sound launches a rising shell whose trail follows the live waveform; it explodes when you stop.

## Tech
- Web Audio API: `AnalyserNode` for RMS volume + FFT; pitch via autocorrelation (~50 lines, no library needed)
- three.js GPU particles: one `BufferGeometry` with per-particle velocity/birth attributes, motion computed in the vertex shader (handles 50k+ particles on mobile)
- Additive blending, slight gravity, exponential fade

## Implementation sketch
1. Mic permission flow with a friendly "マイクをつかうよ" screen.
2. Audio features at 60fps: volume (RMS), pitch (autocorrelation on time-domain data), brightness (centroid of FFT bins).
3. State machine: silence → charging (shell rises while sound continues) → burst on silence.
4. Burst generator: spawn 1–3k particles with direction patterns chosen by timbre; color from pitch via HSL ramp.
5. Stretch: multi-voice mode — friends take turns, each gets a signature color; record a 10s "hanabi show" replay as a GIF/WebM (`MediaRecorder` on the canvas).

## Why it surprises
Zero learning curve — even a baby's shout makes something beautiful. The pitch→color mapping makes kids experiment with their own voices.
