import * as THREE from "three";

// Vite は public/ 配下を配信するため、音声は public/sounds/ に置く。
const SOUND_DIR = `${import.meta.env.BASE_URL}sounds/`;
const RAIN_VOLUME = 0.5;
// リプレイ中は雨が約6.4倍速で落ちる。音でも「本物の速さになった」ことを補強するため、
// 雨ループのピッチと音量を上げる（6.4倍そのままだと甲高い雑音になるので控えめに）。
const REPLAY_RAIN_RATE = 2.2;
const REPLAY_RAIN_VOLUME = 0.62;

/**
 * SE 管理：被弾音・クリア音・ゲームオーバー音・雨ループ（すべて CC0 素材）。
 * 音声ファイルが未配置でもクラッシュしない（警告のみ）。
 * AudioContext はブラウザ仕様上ユーザー操作まで鳴らせないため、
 * コントローラーの selectstart で resume する。
 * REPLAY中は Replayer.frame.hits を見て、記録された被弾のタイミングでも
 * 被弾SEを鳴らす（GAMEOVERの原因をリプレイで振り返れるようにするため）。
 */
export class SoundManager {
  constructor(scene, ctx) {
    this.listener = new THREE.AudioListener();
    ctx.camera.add(this.listener);
    this.controllers = ctx.controllers ?? [];

    this.buffers = { rain: null, hit: null, clear: null, gameover: null };
    this.rain = null;
    this._rainTarget = 0;
    this._rainGain = 0;
    this._rainRateTarget = 1;
    this._rainRate = 1;
    this._lastReplayHitGameTime = null;

    const loader = new THREE.AudioLoader();
    for (const name of ["rain", "hit", "clear", "gameover"]) {
      loader.load(
        SOUND_DIR + name + ".mp3",
        (buffer) => {
          this.buffers[name] = buffer;
          if (name === "rain") this._initRainLoop();
        },
        undefined,
        () =>
          console.warn(
            `[SoundManager] ${SOUND_DIR}${name}.mp3 が読めません（public/sounds/ に配置してください）`
          )
      );
    }

    this._resume = () => this.listener.context.resume?.();
    for (const c of this.controllers) c.addEventListener?.("selectstart", this._resume);

    this._offs = [
      ctx.game.on("hit", () => this._oneShot("hit", 0.9)),
      ctx.game.on("clear", () => this._oneShot("clear", 0.9)),
      ctx.game.on("gameover", () => this._oneShot("gameover", 0.9)),
      ctx.game.on("stateChange", (state) => {
        if (state === "REPLAY") {
          this._rainTarget = REPLAY_RAIN_VOLUME;
          this._rainRateTarget = REPLAY_RAIN_RATE;
          this._lastReplayHitGameTime = null;
        } else {
          this._rainTarget = state === "PLAYING" ? RAIN_VOLUME : 0;
          this._rainRateTarget = 1;
        }
      })
    ];
  }

  _initRainLoop() {
    if (this.rain || !this.buffers.rain) return;
    this.rain = new THREE.Audio(this.listener);
    this.rain.setBuffer(this.buffers.rain);
    this.rain.setLoop(true);
    this.rain.setVolume(0);
    this.rain.play();
  }

  _oneShot(name, volume = 1) {
    const buffer = this.buffers[name];
    const acx = this.listener?.context;
    if (!buffer || !acx) return;
    const source = acx.createBufferSource();
    source.buffer = buffer;
    const gain = acx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(this.listener.getInput());
    source.start();
  }

  update(dt, ctx) {
    if (ctx?.game?.state === "REPLAY") {
      const frame = ctx.replayer?.frame;
      if (frame?.hits?.length && frame.gameTime !== this._lastReplayHitGameTime) {
        this._lastReplayHitGameTime = frame.gameTime;
        this._oneShot("hit", 0.9);
      }
    }

    this._rainGain += (this._rainTarget - this._rainGain) * Math.min(1, dt * 2);
    this._rainRate += (this._rainRateTarget - this._rainRate) * Math.min(1, dt * 3);
    if (this.rain) {
      this.rain.setVolume(this._rainGain);
      this.rain.setPlaybackRate(this._rainRate);
    }
  }

  dispose() {
    this._offs.forEach((off) => off && off());
    for (const c of this.controllers) c.removeEventListener?.("selectstart", this._resume);
    if (this.rain) this.rain.stop();
    this.listener.parent?.remove(this.listener);
  }
}
