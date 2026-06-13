# てのひら テルミン

## 概要
カメラの前で両手を動かすと、手の高さで音程、開き具合で音色が変わる空中楽器。音に合わせて画面全体が脈動するビジュアライザーと一体になった、演奏できるメディアアート。

## Concept (EN)
A camera theremin + audiovisual instrument. Right hand height = pitch (quantized to a pentatonic scale so everything sounds good), left hand height = volume/filter, pinch gestures pluck arpeggios, open palm = sustained pad. Every sound event spawns synchronized visuals: pitch maps to a vertical light position, timbre to geometry (sharp sounds = crystalline shards, soft pads = aurora ribbons). Essentially a tiny playable VJ rig.

## Tech
- MediaPipe Hands for both hands; pinch = thumb-index distance
- Web Audio: 2-oscillator synth + lowpass filter + delay/reverb (`ConvolverNode` with a generated impulse response). Tone.js optional but vanilla is ~150 lines
- three.js visuals: aurora ribbons (animated noise displaced planes, additive), shard particles; bloom pass
- Pentatonic quantization is the key UX trick — no wrong notes

## Implementation sketch
1. Hand → continuous params: y→scale degree (snapped), x→stereo pan, openness (mean fingertip-palm distance)→filter cutoff.
2. Synth voice with portamento between snapped notes for the theremin glide feel.
3. Visual bus: every param also drives the shader uniforms; on pinch, trigger an arpeggio + radial shockwave.
4. Auto-accompaniment: a soft generative drone in the same key so even random waving sounds like ambient music.
5. Stretch: loop recorder (record 8s of hand-played melody, layer it); two-player duet mode.

## Why it surprises
Anyone can play beautiful music in 5 seconds. The fusion of sound and visuals from the same gesture feels like conducting light.
