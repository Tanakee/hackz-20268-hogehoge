/**
 * PLAYING中、毎フレームの頭・手・雨粒位置と被弾イベントを記録する。
 * 記録したフレーム列は Replayer にそのまま渡す。
 */
export class Recorder {
  constructor() {
    this.frames = [];
    this._recording = false;
    this._elapsed = 0;
  }

  start() {
    this.frames = [];
    this._recording = true;
    this._elapsed = 0;
  }

  stop() {
    this._recording = false;
  }

  get isRecording() {
    return this._recording;
  }

  /**
   * head / handLeft / handRight: { x, y, z, qx, qy, qz, qw } または null
   * rainPositions: RainPhysics.positions（Float32Array）
   * hits: このフレームで PlayerCollider.findHits() が返した配列（空配列可）
   */
  record(dt, head, handLeft, handRight, rainPositions, hits = []) {
    if (!this._recording) return;

    this._elapsed += dt;
    this.frames.push({
      t: this._elapsed,
      head: head ? { ...head } : null,
      handLeft: handLeft ? { ...handLeft } : null,
      handRight: handRight ? { ...handRight } : null,
      rainPositions: rainPositions.slice(),
      hits
    });
  }

  getFrames() {
    return this.frames;
  }
}
