import * as THREE from "three";
import { createPanel } from "./_panel.js";

const REDUCED_MOTION =
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * スタート画面（視界追従の3Dパネル）。
 * START 状態のときだけ表示し、コントローラーのトリガー（selectstart）で `game.start()` を呼ぶ。
 * ※ presentation から core への呼び出しはライフサイクルメソッドのみ（DEVPLAN 接続ルール）。
 */
export class StartScreen {
  constructor(scene, ctx) {
    this.camera = ctx.camera;
    this.game = ctx.game;
    this.controllers = ctx.controllers ?? [];
    this._t = 0;

    this.panel = createPanel({ worldWidth: 1.1, worldHeight: 0.6, pxWidth: 768, pxHeight: 420 });
    this._drawStatic();

    this.group = new THREE.Group();
    this.group.position.set(0, -0.02, -1.4);
    this.group.add(this.panel.mesh);
    this.group.visible = true;
    this.camera.add(this.group);

    this._onSelect = () => {
      if (this.game?.state === "START") this.game.start();
    };
    for (const controller of this.controllers) {
      controller.addEventListener?.("selectstart", this._onSelect);
    }
  }

  _drawStatic() {
    this.panel.draw((c, w, h) => {
      c.fillStyle = "rgba(8,12,22,0.55)";
      c.fillRect(0, 0, w, h);
      c.strokeStyle = "rgba(124,196,255,0.5)";
      c.lineWidth = 3;
      c.strokeRect(8, 8, w - 16, h - 16);

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

  update(dt, ctx) {
    const show = ctx.game?.state === "START";
    this.group.visible = show;
    if (!show) return;

    this._t += dt;
    const pulse = REDUCED_MOTION ? 1 : 1 + Math.sin(this._t * 2) * 0.01;
    this.group.scale.setScalar(pulse);
  }

  dispose() {
    for (const controller of this.controllers) {
      controller.removeEventListener?.("selectstart", this._onSelect);
    }
    this.camera.remove(this.group);
    this.panel.dispose();
  }
}
