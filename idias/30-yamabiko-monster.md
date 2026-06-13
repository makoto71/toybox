# やまびこ モンスター

## 概要
くらい洞窟の中に、目だけ光るモンスターたちがひそんでいる。「ヤッホー!」とさけぶと、モンスターたちが順番にまねして返してくれる——ただし、ひとりは超高速ボイス、ひとりは地ひびきの大男声、ひとりはロボット声。自分の声がへんてこに変身して返ってくるたび、子どもは何度でもさけぶ。しゃべった通りに口がパクパク動くのもかわいい。

## Concept (EN)
An echo cave full of voice-mimicking monsters. Speak, and your utterance bounces back transformed: chipmunk, giant, robot, ghost-whisper, backwards. Each monster has a signature transformation and lip-syncs while "speaking". It is the Talking-Tom loop — record, transform, replay — but staged as a cave of characters with overlapping comedic echoes, fully offline.

## Tech
- Capture: mic via `getUserMedia` → simple VAD (RMS over threshold with ~400 ms hangover) chops utterances automatically — no record button, which matters for small kids. Keep utterances ≤ 5 s in an `AudioBuffer`.
- Transformations (all Web Audio, no ML):
  - Chipmunk / giant: `AudioBufferSourceNode.playbackRate` 1.6 / 0.6 (pitch+speed change is *funnier* for kids than formant-correct shifting; offer a granular pitch-shift — overlapping 50 ms grains with crossfade — for a "same speed, different pitch" monster).
  - Robot: ring modulator (multiply by 30–50 Hz sine via a `GainNode` driven by an oscillator) + slight bitcrush (WaveShaper).
  - Ghost: reverse the buffer + convolution reverb (tiny baked IR asset).
  - Echo chain: each monster replays in turn with 250 ms gaps and −4 dB steps — the cave answers as a round.
- Visuals: three.js dark cave with parallax layers; monsters are simple rigged blobs (glowing eyes always visible, body fades in when speaking). Lip sync = mouth scale follows the playback amplitude envelope (`AnalyserNode` on each monster's output); eyes blink and look toward the loudest live input direction (stereo mic if available, else random).
- Spectrogram "speech bubble" floats up as each monster talks (draw FFT slices to a small canvas texture) — makes the transformation visible too.

## Implementation sketch
1. VAD recorder + instant playback at altered rate — the core giggle, ship-worthy in a day.
2. Add 4 monsters with distinct transforms + amplitude-driven mouths.
3. Echo-round sequencing; interrupt rule: a new utterance silences the cave (kids will discover shouting over the echo).
4. Discovery mechanic: a 5th monster only wakes if you *whisper* (low RMS, long duration); a 6th only for singing (pitch stability check) — hidden friends drive replay.
5. Stretch: duet mode — cave layers your last two utterances together; export a "cave concert" as WebM.

## Pitfalls
- Feedback loops (mic hears the monsters) → pause VAD while any monster is speaking, and/or `echoCancellation: true`.
- iOS unlocks audio only after a user gesture → big friendly "knock on the cave door" start button.

## Why it surprises
Hearing your own voice transformed is one of the oldest, most reliable laughs in the world — helium balloons prove it. Staging it as shy creatures who *answer* you adds theater: kids aren't using a sound effect app, they're making friends with a cave. The whisper-only monster turns volume itself into a game mechanic.
