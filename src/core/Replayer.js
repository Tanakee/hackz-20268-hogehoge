import { REPLAY_MULTIPLIER, GAME_DURATION } from "../utils/constants.js";

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

function buildFrame({ gameTime, replayElapsed, head, handLeft, handRight, rainPositions, hits, livesRemaining }) {
  return {
    gameTime,                                          // 元のプレイ中の経過秒数（補間済み）
    replayElapsed,                                      // リプレイ自体の経過秒数（倍速後）
    timeRemaining: Math.max(0, GAME_DURATION - gameTime), // HUDのタイマー表示用
    livesRemaining,                                      // HUDのハート表示用（離散値・補間しない）
    head,
    handLeft,
    handRight,
    rainPositions,
    hits
  };
}

/**
 * Recorder.getFrames() の記録データを REPLAY_MULTIPLIER 倍速で再生するイテレーター。
 * `frame` に現在フレームを保持するので、presentation側（RainRenderer・PlayerAvatar・HUD）は
 * 毎フレーム Replayer.frame を読むだけでよい。
 *
 * 記録は毎フレーム（実機で約90Hz）だが、REPLAY_MULTIPLIER（≒4.67倍速）で再生すると
 * 描画1フレームあたり複数の記録フレームをスキップすることになる。単純に「一番近い
 * フレームへスナップ」すると動きが飛び飛びになってカクつくため、隣接フレーム間を
 * 線形補間して滑らかな位置を返す。スキップした区間の被弾イベント（hits）も
 * 取りこぼさないよう合算して返す。
 *
 * HUD復元用に gameTime / timeRemaining / livesRemaining も frame に含める。
 * livesRemainingは離散値のため補間せず、区間開始側フレームの値をそのまま使う。
 */
export class Replayer {
  constructor(frames, multiplier = REPLAY_MULTIPLIER) {
    this.frames = frames;
    this.multiplier = multiplier;
    this._elapsed = 0;
    this._index = 0;
    this._finished = frames.length === 0;
    this.frame = frames.length > 0 ? this._frameFromRecorded(frames[0], 0) : null;
  }

  get isFinished() {
    return this._finished;
  }

  _frameFromRecorded(recorded, replayElapsed) {
    return buildFrame({
      gameTime: recorded.t,
      replayElapsed,
      head: recorded.head,
      handLeft: recorded.handLeft,
      handRight: recorded.handRight,
      rainPositions: recorded.rainPositions,
      hits: recorded.hits ?? [],
      livesRemaining: recorded.livesRemaining
    });
  }

  reset() {
    this._elapsed = 0;
    this._index = 0;
    this._finished = this.frames.length === 0;
    this.frame = this.frames.length > 0 ? this._frameFromRecorded(this.frames[0], 0) : null;
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
      this.frame = buildFrame({
        gameTime: current.t,
        replayElapsed: this._elapsed,
        head: current.head,
        handLeft: current.handLeft,
        handRight: current.handRight,
        rainPositions: current.rainPositions,
        hits: passedHits.length ? passedHits : current.hits ?? [],
        livesRemaining: current.livesRemaining
      });
      this._finished = true;
      return;
    }

    const span = next.t - current.t;
    const t = span > 0 ? Math.min(1, Math.max(0, (this._elapsed - current.t) / span)) : 0;

    this.frame = buildFrame({
      gameTime: lerp(current.t, next.t, t),
      replayElapsed: this._elapsed,
      head: lerpPose(current.head, next.head, t),
      handLeft: lerpPose(current.handLeft, next.handLeft, t),
      handRight: lerpPose(current.handRight, next.handRight, t),
      rainPositions: lerpFloatArray(current.rainPositions, next.rainPositions, t),
      hits: passedHits,
      livesRemaining: current.livesRemaining
    });
  }
}
