import { GAME_DURATION, PLAYER_LIVES } from "../utils/constants.js";

export const GameState = Object.freeze({
  START: "START",
  PLAYING: "PLAYING",
  CLEAR: "CLEAR",
  GAMEOVER: "GAMEOVER",
  REPLAY: "REPLAY"
});

/**
 * ゲーム全体の状態遷移・ライフ・タイマーを管理する。
 * presentation側はイベント（on）を購読するだけで、GameManagerを書き換えない。
 *
 * 遷移: START → PLAYING → (CLEAR | GAMEOVER) → REPLAY → START
 * CLEAR/GAMEOVERからREPLAYへの遷移は startReplay() を呼んだタイミングで起きる
 * （被弾/クリア演出の尺は presentation 側の管轄のため、ここでは自動遷移しない）。
 */
export class GameManager {
  constructor() {
    this.state = GameState.START;
    this.lives = PLAYER_LIVES;
    this.timeRemaining = GAME_DURATION;
    this._listeners = new Map();
  }

  on(event, handler) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(handler);
    return () => this._listeners.get(event)?.delete(handler);
  }

  emit(event, payload) {
    this._listeners.get(event)?.forEach((handler) => handler(payload));
  }

  _setState(state) {
    this.state = state;
    this.emit("stateChange", state);
  }

  start() {
    if (this.state !== GameState.START) return;
    this.lives = PLAYER_LIVES;
    this.timeRemaining = GAME_DURATION;
    this._setState(GameState.PLAYING);
  }

  update(dt) {
    if (this.state !== GameState.PLAYING) return;

    this.timeRemaining -= dt;
    if (this.timeRemaining <= 0) {
      this.timeRemaining = 0;
      this._setState(GameState.CLEAR);
      this.emit("clear");
    }
  }

  /** PlayerCollider.findHits() の結果（1つの被弾）を渡す */
  registerHit(payload) {
    if (this.state !== GameState.PLAYING) return;

    this.lives -= 1;
    this.emit("hit", { ...payload, livesRemaining: this.lives });

    if (this.lives <= 0) {
      this.lives = 0;
      this._setState(GameState.GAMEOVER);
      this.emit("gameover");
    }
  }

  /** CLEAR/GAMEOVER演出が終わったタイミングで presentation 側から呼ぶ */
  startReplay() {
    if (this.state !== GameState.CLEAR && this.state !== GameState.GAMEOVER) return;
    this._setState(GameState.REPLAY);
  }

  /** リプレイ再生が終わったタイミングで Replayer 側から呼ぶ */
  finishReplay() {
    if (this.state !== GameState.REPLAY) return;
    this._setState(GameState.START);
  }
}
