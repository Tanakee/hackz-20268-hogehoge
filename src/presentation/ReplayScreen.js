import * as THREE from "three";
import { createPanel } from "./_panel.js";

const FADE_IN = 0.6; // クリア/ゲームオーバー → 暗転
const HOLD = 1.0; // 見出しを見せる余韻
const FADE_OUT = 0.6; // リプレイ開始に向けて明転
const EXIT_DUR = 0.8; // リプレイ終了時の軽い明滅

const REDUCED_MOTION =
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const SCRIM_MAX = REDUCED_MOTION ? 0.3 : 0.55;

/**
 * リプレイ前後のトランジション演出。
 *  - clear / gameover を受けたら暗転＋見出し（CLEAR / GAME OVER）→ 余韻 → game.startReplay()
 *  - リプレイが始まったら明転
 *  - リプレイが終わったら軽い明滅
 * ※ 遷移の「尺」は演出側の管轄。core は自動で REPLAY に進まない（DEVPLAN 接続ルール）。
 */
export class ReplayScreen {
  constructor(scene, ctx) {
    this.camera = ctx.camera;
    this.game = ctx.game;

    // 暗転スクリム（カメラの子・視界を覆う黒板）
    this.scrim = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        toneMapped: false
      })
    );
    this.scrim.position.set(0, 0, -0.15);
    this.scrim.renderOrder = 90000;
    this.scrim.frustumCulled = false;
    this.scrim.visible = false;
    this.camera.add(this.scrim);

    // 見出しパネル
    this.panel = createPanel({ worldWidth: 1.3, worldHeight: 0.5, pxWidth: 768, pxHeight: 300 });
    this.panel.mesh.position.set(0, 0.05, -1.3);
    this.panel.mesh.renderOrder = 95000;
    this.panel.mesh.visible = false;
    this.camera.add(this.panel.mesh);

    this._phase = "idle"; // idle | outro | enter | exit
    this._t = 0;
    this._outcome = null;
    this._wasReplay = false;

    this._offs = [
      ctx.game.on("clear", () => this._beginOutro("clear")),
      ctx.game.on("gameover", () => this._beginOutro("gameover")),
      ctx.game.on("stateChange", (s) => {
        if (this._wasReplay && s !== "REPLAY") this._beginExit();
        this._wasReplay = s === "REPLAY";
      })
    ];
  }

  _beginOutro(outcome) {
    this._outcome = outcome;
    this._phase = "outro";
    this._t = 0;
    this.scrim.visible = true;
    this.scrim.material.opacity = 0;
    this.panel.mesh.visible = true;
    this.panel.mesh.material.opacity = 0;
    this._drawTitle(outcome);
  }

  _beginExit() {
    this._phase = "exit";
    this._t = 0;
    this.scrim.visible = true;
    // enterフェーズ（見出しパネルのフェードアウト）が完了する前にリプレイが
    // 終わってしまうケース（記録が短い＝早期GAMEOVER等）があるため、ここで
    // 確実に隠す。隠さないとStartScreenのRESULT画面と文字が二重に見えてしまう。
    this.panel.mesh.visible = false;
  }

  _drawTitle(outcome) {
    this.panel.draw((c, w, h) => {
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.font = "800 120px system-ui, sans-serif";
      c.fillStyle = outcome === "clear" ? "#5ad19b" : "#ff6b6b";
      c.fillText(outcome === "clear" ? "CLEAR" : "GAME OVER", w / 2, h / 2);
    });
  }

  update(dt) {
    if (this._phase === "idle") return;
    this._t += dt;

    if (this._phase === "outro") {
      const fadeK = Math.min(1, this._t / FADE_IN);
      this.scrim.material.opacity = SCRIM_MAX * fadeK;
      this.panel.mesh.material.opacity = fadeK;
      if (this._t >= FADE_IN + HOLD) {
        // 余韻おわり → core にリプレイ開始を依頼して明転へ
        if (this.game.state === "CLEAR" || this.game.state === "GAMEOVER") {
          this.game.startReplay();
        }
        this._phase = "enter";
        this._t = 0;
      }
      return;
    }

    if (this._phase === "enter") {
      const k = Math.min(1, this._t / FADE_OUT);
      this.scrim.material.opacity = SCRIM_MAX * (1 - k);
      this.panel.mesh.material.opacity = 1 - k;
      if (k >= 1) {
        this._phase = "idle";
        this.scrim.visible = false;
        this.panel.mesh.visible = false;
      }
      return;
    }

    if (this._phase === "exit") {
      // 0 → 0.4 → 0 の軽い明滅
      const k = Math.min(1, this._t / EXIT_DUR);
      this.scrim.material.opacity = Math.sin(k * Math.PI) * 0.4;
      if (k >= 1) {
        this._phase = "idle";
        this.scrim.visible = false;
      }
    }
  }

  dispose() {
    this._offs.forEach((off) => off && off());
    this.camera.remove(this.scrim);
    this.camera.remove(this.panel.mesh);
    this.scrim.geometry.dispose();
    this.scrim.material.dispose();
    this.panel.dispose();
  }
}
