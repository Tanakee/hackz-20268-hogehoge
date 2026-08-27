import * as THREE from "three";
import { PLAYER_LIVES, GAME_DURATION } from "../utils/constants.js";
import { createPanel } from "./_panel.js";

const REDUCED_MOTION =
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * RESULT 画面で「スコア」と「ランク」を出す独立モジュール。
 * StartScreen（CLEAR/GAME OVER＋被弾/生存＋操作）の“上”に重ねて表示する。
 * StartScreen・core・状態機械は無変更。`game.on("clear"/"gameover")` を購読して
 * 被弾回数・生存秒数からスコアを算出し、RESULT のあいだカウントアップ表示する。
 * RESULT ⇄ REPLAY を行き来してもスコアは保持（同じ結果オブジェクトの間は再アニメしない）。
 */

const SCORE = {
  TIME_PTS: 100, // 生存1秒あたり
  HIT_PENALTY: 200, // 被弾1回あたり
  CLEAR_BONUS: 1000, // クリアで加算
  PERFECT_BONUS: 2000, // クリア＋無傷で追加
  RANKS: [
    // 上から順に判定（score 以上でそのランク）
    // S=無傷クリア / A=1被弾クリア / B=2被弾クリア or 終盤で被弾GO / C=それ以外
    { key: "S", min: 5500, color: "#ffd76a" },
    { key: "A", min: 3700, color: "#5ad19b" },
    { key: "B", min: 2000, color: "#7cc4ff" },
    { key: "C", min: -Infinity, color: "#9fb4d6" }
  ],
  COUNT_SEC: 0.9 // カウントアップの尺
};

function calcScore(outcome, hits, survived) {
  let s =
    Math.round(survived) * SCORE.TIME_PTS -
    hits * SCORE.HIT_PENALTY +
    (outcome === "clear" ? SCORE.CLEAR_BONUS : 0) +
    (outcome === "clear" && hits === 0 ? SCORE.PERFECT_BONUS : 0);
  return Math.max(0, s);
}
function rankFor(score) {
  return SCORE.RANKS.find((r) => score >= r.min) ?? SCORE.RANKS[SCORE.RANKS.length - 1];
}
function easeOut(x) {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
}

export class ScorePanel {
  constructor(scene, ctx) {
    this.camera = ctx.camera;
    this.game = ctx.game;

    this._result = null; // { outcome, hits, survived, score, rank, parts }
    this._animFor = null;
    this._anim = 0; // 0..1 カウントアップ
    this._rankT = 0; // 0..1 ランク出現
    this._t = 0;
    this._sig = "";

    this.panel = createPanel({ worldWidth: 0.98, worldHeight: 0.44, pxWidth: 900, pxHeight: 404 });

    this.group = new THREE.Group();
    this.group.position.set(0, 0.33, -1.4); // StartScreen の RESULT パネルの上
    this.group.add(this.panel.mesh);
    this.group.visible = false;
    this.camera.add(this.group);

    const capture = (outcome) => {
      const lives = Math.max(0, this.game.lives ?? 0);
      const hits = PLAYER_LIVES - lives;
      const survived =
        outcome === "clear" ? GAME_DURATION : GAME_DURATION - (this.game.timeRemaining ?? 0);
      const score = calcScore(outcome, hits, survived);
      this._result = {
        outcome,
        hits,
        survived,
        score,
        rank: rankFor(score),
        parts: [
          ["生存", Math.round(survived) * SCORE.TIME_PTS],
          ["被弾", -hits * SCORE.HIT_PENALTY],
          ["クリア", outcome === "clear" ? SCORE.CLEAR_BONUS : 0],
          ["無傷", outcome === "clear" && hits === 0 ? SCORE.PERFECT_BONUS : 0]
        ].filter(([, v]) => v !== 0)
      };
    };
    this._offs = [
      ctx.game.on("clear", () => capture("clear")),
      ctx.game.on("gameover", () => capture("gameover"))
    ];
  }

  _draw(shown) {
    const r = this._result;
    this.panel.draw((c, w, h) => {
      // ふわっとした暗がり（板に見せない）
      const g = c.createRadialGradient(w / 2, h * 0.5, 30, w / 2, h * 0.5, w * 0.6);
      g.addColorStop(0, "rgba(8,12,22,0.62)");
      g.addColorStop(1, "rgba(8,12,22,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);

      c.textAlign = "center";
      c.textBaseline = "middle";

      c.fillStyle = "#9fb4d6";
      c.font = "600 34px system-ui, sans-serif";
      c.fillText("SCORE", w * 0.5, h * 0.16);

      // 大きい数字（左寄せ気味）＋ランク（右）
      c.fillStyle = "#eef4ff";
      c.font = "800 132px system-ui, sans-serif";
      c.shadowColor = "#8fd0ff";
      c.shadowBlur = 22;
      c.fillText(String(shown).padStart(1, "0"), w * 0.42, h * 0.45);
      c.shadowBlur = 0;

      // ランク（カウントアップ後にポップイン）
      const rt = easeOut(this._rankT);
      if (rt > 0.01) {
        c.save();
        c.translate(w * 0.82, h * 0.45);
        c.scale(0.6 + 0.4 * rt, 0.6 + 0.4 * rt);
        c.globalAlpha = rt;
        c.fillStyle = r.rank.color;
        c.font = "900 110px system-ui, sans-serif";
        c.fillText(r.rank.key, 0, 0);
        c.globalAlpha = 1;
        c.restore();
      }

      // 内訳
      c.fillStyle = "#9fb4d6";
      c.font = "500 27px system-ui, sans-serif";
      const parts = r.parts
        .map(([label, v]) => `${label} ${v > 0 ? "+" : ""}${v}`)
        .join("　　");
      c.fillText(parts, w * 0.5, h * 0.8);
    });
  }

  update(dt, ctx) {
    this._t += dt;
    const show = ctx.game?.state === "RESULT" && !!this._result;
    this.group.visible = show;
    if (!show) return;

    const r = this._result;
    if (r !== this._animFor) {
      this._animFor = r;
      this._anim = REDUCED_MOTION ? 1 : 0;
      this._rankT = REDUCED_MOTION ? 1 : 0;
    }

    if (this._anim < 1) this._anim = Math.min(1, this._anim + dt / SCORE.COUNT_SEC);
    else if (this._rankT < 1) this._rankT = Math.min(1, this._rankT + dt / 0.3);

    const shown = Math.round(easeOut(this._anim) * r.score);
    const sig = `${shown}|${this._rankT >= 1 ? 1 : Math.round(this._rankT * 20)}`;
    if (sig !== this._sig) {
      this._draw(shown);
      this._sig = sig;
    }

    this.group.scale.setScalar(REDUCED_MOTION ? 1 : 1 + Math.sin(this._t * 2) * 0.008);
  }

  dispose() {
    this._offs?.forEach((off) => off && off());
    this.camera.remove(this.group);
    this.panel.dispose();
  }
}
