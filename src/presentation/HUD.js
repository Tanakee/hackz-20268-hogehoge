import * as THREE from "three";
import { PLAYER_LIVES } from "../utils/constants.js";
import { createPanel, roundRect } from "./_panel.js";

const PX_W = 512;
const PX_H = 224;

/**
 * 視界追従の HUD。
 *   - PLAYING : ハート（残ライフ）＋ 残り秒数
 *   - REPLAY  : リプレイ進行バー（ctx.replayer.progress を参照）
 *   - それ以外 : 非表示
 * 値は core の公開プロパティを毎フレーム読むだけ（GameManager.lives / .timeRemaining）。
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
      const p = clamp(ctx.replayer?.progress ?? 0, 0, 1);
      sig = `replay|${p.toFixed(3)}`;
      if (sig !== this._sig) this._drawReplay(p);
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

  _drawReplay(progress) {
    this.panel.draw((c, w, h) => {
      c.fillStyle = "#7cc4ff";
      c.font = "600 34px system-ui, sans-serif";
      c.textAlign = "left";
      c.textBaseline = "top";
      c.fillText("REPLAY", 36, 34);

      const barX = 36;
      const barY = h / 2 + 4;
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
