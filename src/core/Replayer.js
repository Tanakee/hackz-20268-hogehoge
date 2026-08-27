import { REPLAY_MULTIPLIER } from "../utils/constants.js";

/**
 * Recorder.getFrames() の記録データを REPLAY_MULTIPLIER 倍速で再生するイテレーター。
 * `frame` に現在フレームを保持するので、presentation側（RainRenderer・PlayerAvatar）は
 * 毎フレーム Replayer.frame を読むだけでよい。
 */
export class Replayer {
  constructor(frames, multiplier = REPLAY_MULTIPLIER) {
    this.frames = frames;
    this.multiplier = multiplier;
    this.frame = frames.length > 0 ? frames[0] : null;
    this._elapsed = 0;
    this._index = 0;
    this._finished = frames.length === 0;
  }

  get isFinished() {
    return this._finished;
  }

  reset() {
    this._elapsed = 0;
    this._index = 0;
    this._finished = this.frames.length === 0;
    this.frame = this.frames.length > 0 ? this.frames[0] : null;
  }

  update(dt) {
    if (this._finished) return;

    this._elapsed += dt * this.multiplier;

    while (
      this._index < this.frames.length - 1 &&
      this.frames[this._index + 1].t <= this._elapsed
    ) {
      this._index += 1;
    }

    this.frame = this.frames[this._index];

    if (this._index >= this.frames.length - 1) {
      this._finished = true;
    }
  }
}
