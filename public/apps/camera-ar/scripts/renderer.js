export class Renderer {
  constructor(canvas, video, faceMeshDetector, overlayManager) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.video = video;
    this.detector = faceMeshDetector;
    this.overlay = overlayManager;
    this.running = false;
    this.animationId = null;
  }

  start() {
    this.canvas.width = this.video.videoWidth;
    this.canvas.height = this.video.videoHeight;
    this.running = true;
    this.loop();
  }

  stop() {
    this.running = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  loop() {
    if (!this.running) return;

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Mirror and draw video
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(this.video, -w, 0, w, h);
    ctx.restore();

    // Detect faces
    const timestamp = performance.now();
    const faceLandmarks = this.detector.detect(this.video, timestamp);

    // Mirror landmark X coordinates to match mirrored video
    const mirrored = faceLandmarks.map(face =>
      face.map(lm => ({ ...lm, x: 1 - lm.x }))
    );

    // Draw overlays
    this.overlay.draw(ctx, mirrored, w, h);

    this.animationId = requestAnimationFrame(() => this.loop());
  }
}
