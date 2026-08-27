import * as THREE from "three";
import { PLAYER_LIVES } from "../utils/constants.js";
import { createPanel, roundRect } from "./_panel.js";

const PX_W = 512;
const PX_H = 224;

/**
 * 視界追従の HUD。
 *   - PLAYING : ハート（残ライフ）＋ 残り秒数
 *   - REPLAY  : その瞬間のハート・残り秒数（記録データから復元）＋ 進行バー
 *   - それ以外 : 非表示
 * 値は core の公開プロパティを毎フレーム読むだけ（PLAYING中は GameManager.lives /
 * .timeRemaining、REPLAY中は Replayer.frame.livesRemaining / .timeRemaining / progress）。
 */
export class HUD {
  constructor(scene, ctx) {
    this.camera = ctx.camera;
    this.panel = createPanel({ worldWidth: 0.72, worldHeight: 0.315, pxWidth: PX_W, pxHeight: PX_H });

    this.group = new THREE.Group();
    this.group.position.set(0, -0.33, -1.1);
    this.group.rotation.x = 0.12; // 少し見上げる角度
    this.group.add(this.panel.mesh);
    this.group.visible = false;
    this.camera.add(this.group);

    this._sig = null;
  }

  update(_dt, ctx) {
    const state = ctx.game?.state;
    let sig;

    if (state === "PLAYING") {
      const lives = Math.max(0, ctx.game.lives ?? 0);
      const secs = Math.max(0, ctx.game.timeRemaining ?? 0);
      sig = `play|${lives}|${secs.toFixed(1)}`;
      if (sig !== this._sig) this._drawPlaying(lives, secs);
      this.group.visible = true;
    } else if (state === "REPLAY") {
      const frame = ctx.replayer?.frame;
      const p = clamp(ctx.replayer?.progress ?? 0, 0, 1);
      const lives = Math.max(0, frame?.livesRemaining ?? 0);
      const secs = Math.max(0, frame?.timeRemaining ?? 0);
      sig = `replay|${p.toFixed(3)}|${lives}|${secs.toFixed(1)}`;
      if (sig !== this._sig) this._drawReplay(p, lives, secs);
      this.group.visible = true;
    } else {
      sig = "hidden";
      this.group.visible = false;
    }
    this._sig = sig;
  }

  _drawPlaying(lives, secs) {
    this.panel.draw((c, w, h) => {
      // ハート
      const s = 34;
      const gap = 84;
      const startX = 46;
      const y = 56;
      for (let i = 0; i < PLAYER_LIVES; i++) {
        heartPath(c, startX + i * gap, y, s);
        c.fillStyle = i < lives ? "#ff5b6b" : "#38495f";
        c.fill();
      }
      // 残り秒
      c.fillStyle = "#eaf1ff";
      c.font = "600 96px system-ui, sans-serif";
      c.textAlign = "right";
      c.textBaseline = "alphabetic";
      c.fillText(secs.toFixed(1), w - 36, h - 40);
      c.font = "500 30px system-ui, sans-serif";
      c.fillStyle = "#8ea3c4";
      c.fillText("SEC", w - 36, h - 8);
    });
  }

  _drawReplay(progress, lives, secs) {
    this.panel.draw((c, w, h) => {
      // 上段：その瞬間のハート（左）＋ 残り秒数（右）。PLAYING中と同じ値を記録データから復元。
      const s = 26;
      const gap = 62;
      const startX = 40;
      const heartY = 40;
      for (let i = 0; i < PLAYER_LIVES; i++) {
        heartPath(c, startX + i * gap, heartY, s);
        c.fillStyle = i < lives ? "#ff5b6b" : "#38495f";
        c.fill();
      }

      c.fillStyle = "#eaf1ff";
      c.font = "600 56px system-ui, sans-serif";
      c.textAlign = "right";
      c.textBaseline = "alphabetic";
      c.fillText(secs.toFixed(1), w - 30, 60);
      c.font = "500 22px system-ui, sans-serif";
      c.fillStyle = "#8ea3c4";
      c.fillText("SEC", w - 30, 80);

      // 下段：REPLAYラベル＋進行バー
      c.fillStyle = "#7cc4ff";
      c.font = "600 26px system-ui, sans-serif";
      c.textAlign = "left";
      c.textBaseline = "top";
      c.fillText("REPLAY", 36, h - 78);

      const barX = 36;
      const barY = h - 44;
      const barW = w - 72;
      const barH = 22;
      roundRect(c, barX, barY, barW, barH, barH / 2);
      c.fillStyle = "rgba(255,255,255,0.16)";
      c.fill();
      roundRect(c, barX, barY, Math.max(barH, barW * progress), barH, barH / 2);
      c.fillStyle = "#7cc4ff";
      c.fill();
    });
  }

  dispose() {
    this.camera.remove(this.group);
    this.panel.dispose();
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** center (x,y) / おおよその高さ s のハート形パス */
function heartPath(c, x, y, s) {
  const top = y - s * 0.28;
  c.beginPath();
  c.moveTo(x, y + s * 0.55);
  c.bezierCurveTo(x + s * 1.0, y - s * 0.15, x + s * 0.4, top - s * 0.6, x, top);
  c.bezierCurveTo(x - s * 0.4, top - s * 0.6, x - s * 1.0, y - s * 0.15, x, y + s * 0.55);
  c.closePath();
}
