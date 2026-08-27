import { GAME_DURATION, PLAYER_LIVES, READY_DURATION } from "../utils/constants.js";

export const GameState = Object.freeze({
  START: "START",
  READY: "READY",
  PLAYING: "PLAYING",
  CLEAR: "CLEAR",
  GAMEOVER: "GAMEOVER",
  REPLAY: "REPLAY",
  RESULT: "RESULT"
});

/**
 * ゲーム全体の状態遷移・ライフ・タイマーを管理する。
 * presentation側はイベント（on）を購読するだけで、GameManagerを書き換えない
 * （例外はライフサイクルメソッド呼び出し：start() / startReplay() / restart()）。
 *
 * 遷移: START → READY → PLAYING → (CLEAR | GAMEOVER) → RESULT ⇄ REPLAY
 *                                                          ↓
 *                                                        START
 * - STARTからREADYへの遷移は presentation（スタート画面のトリガー操作）が start() を呼ぶ
 * - READYからPLAYINGへの遷移は READY_DURATION 秒後に core が自動で行う（準備カウントダウン。
 *   この間は雨もタイマーも動かない）
 * - CLEAR/GAMEOVERからRESULTへの遷移は showResult() を呼んだタイミングで起きる
 *   （被弾/クリア演出の尺は presentation 側の管轄のため、ここでは自動遷移しない）
 * - RESULT画面は結果表示とあわせて「リプレイ」「終了」の選択肢を提示する
 *   （リプレイを強制せず、ユーザーが選べるようにするため）
 * - RESULTからREPLAYへの遷移は「リプレイ」が選ばれたタイミングで startReplay() を呼んで起きる。
 *   何度でも選び直せる
 * - REPLAYからRESULTへの遷移は Replayer が再生完了時に finishReplay() を呼んで起きる
 *   （coreの中で完結する）
 * - RESULTからSTARTへの遷移は「終了」が選ばれたタイミングで restart() を呼んで起きる
 * lives / timeRemaining は CLEAR〜RESULTの間、次の start() が呼ばれるまで保持されるため、
 * RESULT画面のスコア表示（被弾回数・生存時間）はこれらから計算できる。
 */
export class GameManager {
  constructor() {
    this.state = GameState.START;
    this.lives = PLAYER_LIVES;
    this.timeRemaining = GAME_DURATION;
    this.readyTimeRemaining = READY_DURATION;
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

  /** スタート画面のトリガー操作で呼ばれる。すぐにはPLAYINGにせず、READYの準備時間を挟む */
  start() {
    if (this.state !== GameState.START) return;
    this.readyTimeRemaining = READY_DURATION;
    this._setState(GameState.READY);
  }

  update(dt) {
    if (this.state === GameState.READY) {
      this.readyTimeRemaining -= dt;
      if (this.readyTimeRemaining <= 0) {
        this.readyTimeRemaining = 0;
        this.lives = PLAYER_LIVES;
        this.timeRemaining = GAME_DURATION;
        this._setState(GameState.PLAYING);
      }
      return;
    }

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

  /** CLEAR/GAMEOVER演出が終わったタイミングで presentation 側から呼ぶ。結果画面を表示する */
  showResult() {
    if (this.state !== GameState.CLEAR && this.state !== GameState.GAMEOVER) return;
    this._setState(GameState.RESULT);
  }

  /** RESULT画面で「リプレイ」が選ばれたタイミングで presentation 側から呼ぶ。何度でも呼べる */
  startReplay() {
    if (this.state !== GameState.RESULT) return;
    this._setState(GameState.REPLAY);
  }

  /** リプレイ再生が終わったタイミングで Replayer 側から呼ぶ。RESULT画面に戻る */
  finishReplay() {
    if (this.state !== GameState.REPLAY) return;
    this._setState(GameState.RESULT);
  }

  /** RESULT画面で「終了」が選ばれたタイミングで presentation 側から呼ぶ */
  restart() {
    if (this.state !== GameState.RESULT) return;
    this._setState(GameState.START);
  }
}
