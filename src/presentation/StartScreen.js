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
 *   - START  : タイトル＋モード表示。右トリガーで `game.start()` ／
 *              左トリガーで `ctx.swatMode`（よける⇔殴り飛ばす）を切替
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
    this.ctx = ctx; // モード切替で ctx.swatMode を読み書きするため保持
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
      const hand = event?.target?.userData?.handedness;
      if (state === "START") {
        // 左トリガー＝モード切替、右（または不明）＝開始
        if (hand === "left") {
          this.ctx.swatMode = !this.ctx.swatMode;
          this._sig = null; // イントロを描き直す
        } else {
          this.game.start();
        }
        return;
      }
      if (state === "RESULT") {
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
      ctx.game.on("gameover", () => capture("gameover")),
      // restart() で RESULT → START に戻った後もイントロ画面に切り替わるよう、
      // 直前の結果表示をクリアする（クリアしないと sig が変化せず結果画面のまま固定される）。
      ctx.game.on("stateChange", (state) => {
        if (state === "START") this._result = null;
      })
    ];
  }

  _drawIntro(swat) {
    this.panel.draw((c, w, h) => {
      frame(c, w, h);
      c.textAlign = "center";
      c.textBaseline = "middle";

      c.fillStyle = "#eaf1ff";
      c.font = "700 82px system-ui, sans-serif";
      c.fillText(swat ? "雨を殴り飛ばせ" : "雨をよけろ", w / 2, h * 0.28);

      c.fillStyle = swat ? "#7cf0c4" : "#7cc4ff";
      c.font = "600 34px system-ui, sans-serif";
      c.fillText(`モード：${swat ? "殴り飛ばす" : "よける"}`, w / 2, h * 0.52);

      c.fillStyle = "#eaf1ff";
      c.font = "600 34px system-ui, sans-serif";
      c.fillText("右トリガー：開始", w / 2, h * 0.72);
      c.fillStyle = "#9fb4d6";
      c.font = "500 28px system-ui, sans-serif";
      c.fillText("左トリガー：モード切替", w / 2, h * 0.87);
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
    const swat = !!ctx.swatMode;
    const sig = r
      ? `res|${r.outcome}|${r.hits}|${r.survived.toFixed(1)}`
      : `intro|${swat ? "swat" : "dodge"}`;
    if (sig !== this._sig) {
      if (r) this._drawResult(r);
      else this._drawIntro(swat);
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
