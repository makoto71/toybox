export class CaptureManager {
  constructor(canvas) {
    this.canvas = canvas;
  }

  capture() {
    this.canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `camera-ar-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }
}
