import { REPLAY_MULTIPLIER } from "../utils/constants.js";

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpPose(a, b, t) {
  if (!a || !b) return a || b || null;
  // クォータニオンは正規化線形補間（nlerp）で近似。差分が小さいフレーム間なので十分。
  let qx = lerp(a.qx, b.qx, t);
  let qy = lerp(a.qy, b.qy, t);
  let qz = lerp(a.qz, b.qz, t);
  let qw = lerp(a.qw, b.qw, t);
  const len = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw) || 1;
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
    qx: qx / len,
    qy: qy / len,
    qz: qz / len,
    qw: qw / len
  };
}

function lerpFloatArray(a, b, t) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    out[i] = a[i] + (b[i] - a[i]) * t;
  }
  return out;
}

/**
 * Recorder.getFrames() の記録データを REPLAY_MULTIPLIER 倍速で再生するイテレーター。
 * `frame` に現在フレームを保持するので、presentation側（RainRenderer・PlayerAvatar）は
 * 毎フレーム Replayer.frame を読むだけでよい。
 *
 * 記録は毎フレーム（実機で約90Hz）だが、REPLAY_MULTIPLIER（≒4.67倍速）で再生すると
 * 描画1フレームあたり複数の記録フレームをスキップすることになる。単純に「一番近い
 * フレームへスナップ」すると動きが飛び飛びになってカクつくため、隣接フレーム間を
 * 線形補間して滑らかな位置を返す。スキップした区間の被弾イベント（hits）も
 * 取りこぼさないよう合算して返す。
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

    const passedHits = [];
    while (
      this._index < this.frames.length - 1 &&
      this.frames[this._index + 1].t <= this._elapsed
    ) {
      this._index += 1;
      if (this.frames[this._index].hits?.length) {
        passedHits.push(...this.frames[this._index].hits);
      }
    }

    const current = this.frames[this._index];
    const next = this.frames[this._index + 1];

    if (!next) {
      this.frame = { ...current, hits: passedHits.length ? passedHits : current.hits };
      this._finished = true;
      return;
    }

    const span = next.t - current.t;
    const t = span > 0 ? Math.min(1, Math.max(0, (this._elapsed - current.t) / span)) : 0;

    this.frame = {
      t: this._elapsed,
      head: lerpPose(current.head, next.head, t),
      handLeft: lerpPose(current.handLeft, next.handLeft, t),
      handRight: lerpPose(current.handRight, next.handRight, t),
      rainPositions: lerpFloatArray(current.rainPositions, next.rainPositions, t),
      // 被弾イベントは補間できないため、スキップ区間で発生した分をまとめて渡す
      hits: passedHits
    };
  }
}
