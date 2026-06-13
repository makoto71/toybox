# ひとり がっしょうだん

## 概要
マイクに向かって「あ〜♪」とひとこえ歌うと、ステージにじぶんの分身コーラス隊がずらりと現れて、いま歌った声がきれいなハモリ(3度・5度・オクターブ)になって返ってくる。つづけて歌えば、分身たちがリアルタイムで追いかけながらハモる。ひとりぼっちの鼻歌が、瞬時に大聖堂の合唱になる魔法。

## Concept (EN)
A one-person choir. Sing a note — a row of singer characters appears and answers with your own voice pitch-shifted into a chord (root, +3rd, +5th, octave, sub-octave). In live mode the harmonies track your singing continuously with ~100 ms latency, like a pocket vocoder-choir. Modes change the chord flavor: major (sunny), minor (dramatic), mysterious (whole-tone), "ghost cathedral" (huge reverb + slow attack). Everything on-device with Web Audio.

## Tech
- Pitch shifting (the core): granular real-time shifter in an `AudioWorkletProcessor` — the classic "jungle/chorus" design: 2 overlapping grain players reading from a ring buffer at rate = `2^(semitones/12)` with 80–100 ms grains, Hann crossfade. Per harmony voice = one shifter instance (4–5 voices is cheap). This preserves duration (true harmony, not chipmunk). Formant smearing at ±7 semitones is acceptable — it reads as "choir blend".
- Smart harmony: detect the sung pitch (autocorrelation on the worklet input, 20–40 ms frames) → snap each harmony interval to the selected key/scale (e.g. +3rd becomes major or minor third depending on scale degree). Key selectable or auto-estimated from a histogram of sung pitches.
- Echo mode (for kids who won't sustain notes): VAD-chopped phrase replayed by each singer in staggered rounds at chord intervals — a canon machine, much easier than live mode and very funny.
- Output chain: per-voice panner spread across the stage → `ConvolverNode` cathedral IR → compressor. Slight per-voice detune (±5 cents) + onset jitter (±20 ms) is what makes 5 copies sound like a *choir* instead of a flanger.
- Visuals: three.js stage; singer avatars = simple robed blobs with your choice of face (or a webcam snapshot textured on, MediaPipe face crop); mouths open with per-voice output amplitude; spotlight cones, dust motes; the lead singer (you) glows when input is live.

## Implementation sketch
1. Worklet ring-buffer pitch shifter, one voice at +4 semitones, monitoring through headphones — validate quality and latency.
2. 4 fixed-interval voices + detune/jitter/reverb → the "wow" baseline. Wire amplitude → mouth animation.
3. Pitch tracking + scale-aware intervals; key picker as colored banners.
4. Echo/canon mode with VAD chopping (reuse pattern from やまびこ idea if both get built).
5. Record the full mix (`MediaRecorder` on a `MediaStreamAudioDestinationNode`) → share a clip.
6. Stretch: conduct with hand height via MediaPipe Hands = choir volume/expression; "100 voices" stacked-octave Easter egg.

## Pitfalls
- Feedback howl on speakers → ship with echoCancellation on, duck input while output is loud, and show a headphone hint for live mode.
- Granular shifting of noisy/whispered input sounds rough → gate harmonies below a voicing-confidence threshold (only harmonize when pitch detection is confident).

## Why it surprises
Harmony is the most emotionally loaded trick in music, and almost nobody gets to stand inside it. Hearing your *own* timbre split into a chord triggers a grin in 100% of testers of any age — it's the karaoke fantasy granted instantly. The canon mode turns any nonsense phrase ("パンツ!") into a Renaissance motet, which is exactly the kind of stupid-sublime that gets shared.
