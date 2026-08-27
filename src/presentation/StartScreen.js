import * as THREE from "three";
import { PLAYER_LIVES, GAME_DURATION } from "../utils/constants.js";
import { createPanel } from "./_panel.js";

const REDUCED_MOTION =
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * スタート画面 兼 結果画面（視界追従の3Dパネル）。
 * START / RESULT 状態のときだけ表示する。
 *   - START  : 「雨をよけろ / トリガーで開始」→ トリガーで `game.start()`
 *   - RESULT : 「CLEAR / GAME OVER ＋ 被弾回数・生存時間」＋
 *              右トリガーで「リプレイを見る」(`game.startReplay()`) ／
 *              左トリガーで「終了してスタートへ」(`game.restart()`)
 * リプレイを強制せず、結果を見た上でユーザーが選べるようにする（実機フィードバックにより変更）。
 * ※ presentation から core への呼び出しはライフサイクルメソッドのみ（DEVPLAN 接続ルール）。
 */
export class StartScreen {
  constructor(scene, ctx) {
    this.camera = ctx.camera;
    this.game = ctx.game;
    this.controllers = ctx.controllers ?? [];
    this._t = 0;
    this._sig = null;
    this._result = null; // { outcome, hits, survived }

    this.panel = createPanel({ worldWidth: 1.1, worldHeight: 0.6, pxWidth: 768, pxHeight: 420 });

    this.group = new THREE.Group();
    this.group.position.set(0, -0.02, -1.4);
    this.group.add(this.panel.mesh);
    this.group.visible = true;
    this.camera.add(this.group);

    this._onSelect = (event) => {
      const state = this.game?.state;
      if (state === "START") {
        this.game.start();
        return;
      }
      if (state === "RESULT") {
        const hand = event?.target?.userData?.handedness;
        if (hand === "right") this.game.startReplay();
        else if (hand === "left") this.game.restart();
      }
    };
    for (const controller of this.controllers) {
      controller.addEventListener?.("selectstart", this._onSelect);
    }

    const capture = (outcome) => {
      const lives = Math.max(0, this.game.lives ?? 0);
      this._result = {
        outcome,
        hits: PLAYER_LIVES - lives,
        survived: outcome === "clear" ? GAME_DURATION : GAME_DURATION - (this.game.timeRemaining ?? 0)
      };
    };
    this._offs = [
      ctx.game.on("clear", () => capture("clear")),
      ctx.game.on("gameover", () => capture("gameover"))
    ];
  }

  _drawIntro() {
    this.panel.draw((c, w, h) => {
      frame(c, w, h);
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillStyle = "#eaf1ff";
      c.font = "700 88px system-ui, sans-serif";
      c.fillText("雨をよけろ", w / 2, h * 0.36);
      c.fillStyle = "#9fb4d6";
      c.font = "500 40px system-ui, sans-serif";
      c.fillText("トリガーを引いて開始", w / 2, h * 0.64);
    });
  }

  _drawResult(r) {
    this.panel.draw((c, w, h) => {
      frame(c, w, h);
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillStyle = r.outcome === "clear" ? "#5ad19b" : "#ff6b6b";
      c.font = "800 76px system-ui, sans-serif";
      c.fillText(r.outcome === "clear" ? "CLEAR" : "GAME OVER", w / 2, h * 0.22);

      c.fillStyle = "#cdd9ef";
      c.font = "500 34px system-ui, sans-serif";
      c.fillText(`被弾 ${r.hits} 回 ／ 生存 ${r.survived.toFixed(1)}s`, w / 2, h * 0.46);

      c.fillStyle = "#7cc4ff";
      c.font = "600 30px system-ui, sans-serif";
      c.fillText("右トリガー：リプレイを見る", w / 2, h * 0.68);

      c.fillStyle = "#9fb4d6";
      c.font = "500 30px system-ui, sans-serif";
      c.fillText("左トリガー：終了してスタートへ", w / 2, h * 0.84);
    });
  }

  update(dt, ctx) {
    const state = ctx.game?.state;
    const show = state === "START" || state === "RESULT";
    this.group.visible = show;
    if (!show) return;

    const r = this._result;
    const sig = r ? `res|${r.outcome}|${r.hits}|${r.survived.toFixed(1)}` : "intro";
    if (sig !== this._sig) {
      if (r) this._drawResult(r);
      else this._drawIntro();
      this._sig = sig;
    }

    this._t += dt;
    this.group.scale.setScalar(REDUCED_MOTION ? 1 : 1 + Math.sin(this._t * 2) * 0.01);
  }

  dispose() {
    this._offs?.forEach((off) => off && off());
    for (const controller of this.controllers) {
      controller.removeEventListener?.("selectstart", this._onSelect);
    }
    this.camera.remove(this.group);
    this.panel.dispose();
  }
}

function frame(c, w, h) {
  c.fillStyle = "rgba(8,12,22,0.55)";
  c.fillRect(0, 0, w, h);
  c.strokeStyle = "rgba(124,196,255,0.5)";
  c.lineWidth = 3;
  c.strokeRect(8, 8, w - 16, h - 16);
}
