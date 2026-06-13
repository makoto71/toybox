# じぶん ゾートロープ

## 概要
カメラの前で「歩くポーズ」を8回、ちょっとずつ変えてパシャパシャ撮る。すると切り抜かれた自分が回転木馬みたいな円盤にずらりと並び、円盤をびゅんと指で回してストロボが光ると——あら不思議、自分がパラパラ動き出す! 19世紀の回転のぞき絵「ゾートロープ」を、自分の体で作れるおもちゃ。回すのをやめると、ただの止まった写真の輪に戻るのがまた良い。

## Concept (EN)
A personal zoetrope. Capture 8–12 cutout photos of yourself in incremental poses; they're mounted around a 3D carousel. Spin it with a flick — nothing but a blur — then the strobe kicks in, synced to the frame spacing, and the cutouts fuse into a living animation of you walking / jumping / dabbing in place. The magic is honest: it's the *actual* persistence-of-vision mechanism, not a video trick, and slowing the wheel visibly breaks the illusion back into still photos.

## Tech
- Capture: guided burst — overlay shows frame `i/8` with onion-skin ghost of the previous shot (previous cutout at 30% opacity) so kids can pose incrementally; 3-2-1 countdown per shot, or auto-trigger when MediaPipe Pose detects the body is still.
- Cutout: MediaPipe Selfie Segmentation on each captured frame → alpha-matted sprite (feather the mask edge 2 px; bake to a canvas texture). Fallback without segmentation: circular vignette cards (still works, looks like a Victorian toy).
- Carousel: three.js cylinder of N billboard cards facing outward, on a turntable with flywheel physics (flick velocity, friction decay; can also be cranked by a UI handle).
- Strobe: the actual zoetrope equation — illusion appears when flash frequency `f = N × revs_per_second`. Implement as a fullscreen black overlay whose alpha is 1 except for a short duty-cycle window (~15%) phase-locked to wheel angle `(θ·N/2π) mod 1 < duty`. Evaluated per rendered frame against the *current* angle, so spin-up naturally sweeps through "blur → flicker → locked animation" — the discovery moment. Alternative mode: slotted-drum view (camera looks through moving slits, the historically accurate version).
- Export: re-render the locked loop to GIF/WebM (gif.js in a worker, or `MediaRecorder` on the canvas).

## Implementation sketch
1. Carousel + flywheel + strobe with 8 bundled placeholder drawings — tune duty cycle & frame count until the lock-in feels magical.
2. Capture flow with onion skin; segmentation cutouts.
3. "もの mode": photograph a toy/clay figure in 12 poses on a table (classic claymation gateway).
4. Auto-spin button that ramps the wheel slowly through the lock-in frequency, for the youngest users.
5. Stretch: two-row zoetrope (your frames on top, a drawn character below, interacting); print-out PNG strip to build a real paper zoetrope.

## Pitfalls
- Strobe ↔ display refresh aliasing: clamp wheel speed so flashes stay well under 30 Hz; and offer a "slit view" mode that has no flashing at all.
- Photosensitivity: keep strobe luminance moderate, show the standard flicker advisory, default to slit mode.
- Segmentation halos on busy backgrounds → suggest standing before a plain wall in the capture UI.

## Why it surprises
Every animation a child has ever seen came from a screen, finished. Here they *manufacture* motion from their own frozen bodies and can feel exactly where the magic threshold is by spinning faster and slower. It's a 180-year-old wonder that has lost none of its power, plus a built-in gateway to stop-motion animation.
