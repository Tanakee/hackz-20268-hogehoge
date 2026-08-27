import * as THREE from "three";
import { createPanel } from "./_panel.js";

const REDUCED_MOTION =
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * タイトル演出（START 状態のときだけ走る、視界追従の前段レイヤー）。
 *
 * 既存の StartScreen（「トリガーで開始」パネル）より手前で以下のシーケンスを再生する。
 * 状態機械・StartScreen・core は一切変更しない（index.js に1モジュール足すだけ）。
 *
 *   FALL     : 本物っぽい雨（縦ストリーク）が視界いっぱいに降る
 *   FREEZE   : 全粒の速度がピタッと0。時間停止のきらめき＋放射リング
 *   ASSEMBLE : 各粒がタイトル文字の形の目標点へ弧を描いて集まり、着いた粒から発光
 *   HOLD     : タイトルがゆらぎ、余った粒が漂う。手前のプロンプト目隠しが晴れて
 *              StartScreen の「トリガーで開始」が読めるようになる
 *   EXIT     : START を抜けたら、粒がほどけて雨に戻りながら落ちて消える
 *
 * prefers-reduced-motion のときは即 HOLD（完成形を静止表示）。
 */

const CFG = {
  TITLE: "雨避け",
  SUBTITLE: "― 妄想の雨 ―",
  TEXT: "#eef4ff",
  ACCENT: 0x8fd0ff,
  RAIN_COLOR: 0xbcd6ff,
  GLYPH_COLOR: 0xffffff,

  DROPS: 900, // ストリーク総数（＝文字サンプル点の上限）
  FALL_SEC: 3.6, // 降雨フェーズの長さ
  FREEZE_SEC: 0.55, // 静止フェーズの長さ
  ASSEMBLE_SEC: 1.5, // 1粒あたりの集合時間
  ASSEMBLE_STAGGER: 0.5, // 粒ごとの開始ずれ幅
  EXIT_SEC: 0.55,

  DIST: 1.95, // カメラからタイトル面までの距離(m)
  HEIGHT: 0.34, // タイトルの高さオフセット(m)
  GLYPH_W: 1.5, // 文字が占める横幅(m)
  GLYPH_H: 0.42, // 縦(m)

  SHOCKWAVE: true,
  GLYPH_PANEL: true, // 集合と同時に薄く文字パネルも重ねて可読性を上げる
  PROMPT_VEIL: true, // HOLD になるまで手前の開始プロンプトをうっすら隠す
  VEIL_COLOR: 0x0a0e16
};

const RAIN_RANGE = { x: 1.15, yTop: 1.25, yBot: -0.5, zNear: -1.35, zFar: -2.6 };

export class TitleScreen {
  constructor(scene, ctx) {
    this.camera = ctx.camera;
    this.game = ctx.game;

    this.group = new THREE.Group();
    this.camera.add(this.group);

    this._t = 0;
    this._vis = 0;
    this._phase = "FALL";
    this._phaseT = 0;
    this._wasStart = false;
    this._done = false;

    // 文字サンプル点（タイトル面ローカルの x,y の並び）
    this._targets = this._sampleTitleTargets();
    this._center = new THREE.Vector3(0, CFG.HEIGHT, -CFG.DIST);

    // ストリーク InstancedMesh
    const n = CFG.DROPS;
    const geo = new THREE.CylinderGeometry(0.0045, 0.0045, 1, 5, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      depthTest: false,
      toneMapped: false
    });
    this._mesh = new THREE.InstancedMesh(geo, mat, n);
    this._mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._mesh.frustumCulled = false;
    this._mesh.renderOrder = 9998;
    this._mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.group.add(this._mesh);

    this._drop = [];
    this._rainC = new THREE.Color(CFG.RAIN_COLOR);
    this._glyphC = new THREE.Color(CFG.GLYPH_COLOR);
    for (let i = 0; i < n; i++) {
      this._drop.push({
        pos: new THREE.Vector3(),
        frozen: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        speed: 0,
        len: 1,
        tIndex: i < this._targets.length / 2 ? i : -1, // -1 = 余り粒（文字にならない）
        stagger: Math.random() * CFG.ASSEMBLE_STAGGER,
        bright: 0
      });
    }

    // 放射リング（静止の瞬間）
    this._ring = null;
    if (CFG.SHOCKWAVE) {
      this._ring = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 0.98, 64),
        new THREE.MeshBasicMaterial({
          color: CFG.ACCENT,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          depthTest: false,
          side: THREE.DoubleSide,
          toneMapped: false
        })
      );
      this._ring.position.copy(this._center);
      this._ring.renderOrder = 9997;
      this.group.add(this._ring);
    }

    // 文字パネル（可読性の下支え。集合とともにフェードイン）
    this._panel = null;
    if (CFG.GLYPH_PANEL) {
      this._panel = createPanel({
        worldWidth: CFG.GLYPH_W + 0.5,
        worldHeight: CFG.GLYPH_H + 0.35,
        pxWidth: 1000,
        pxHeight: 420
      });
      this._panel.mesh.position.copy(this._center);
      this._panel.mesh.material.opacity = 0;
      this._drawGlyphPanel();
      this.group.add(this._panel.mesh);
    }

    // 開始プロンプトの目隠し（HOLD までうっすら隠す）
    this._veil = null;
    if (CFG.PROMPT_VEIL) {
      this._veil = new THREE.Mesh(
        new THREE.PlaneGeometry(1.3, 0.72),
        new THREE.MeshBasicMaterial({
          color: CFG.VEIL_COLOR,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          depthTest: false,
          toneMapped: false
        })
      );
      this._veil.position.set(0, -0.02, -1.36); // StartScreen パネル(z≈-1.4)より少し手前
      this._veil.renderOrder = 10050; // StartScreen(10000) より後 = 前に見える
      this.group.add(this._veil);
    }

    this._dummy = new THREE.Object3D();
    this._tmpC = new THREE.Color();
    this._tmpV = new THREE.Vector3();

    this._resetSequence(true);
    if (REDUCED_MOTION) this._snapToHold();
  }

  /** タイトルを一度キャンバスに描き、アルファを格子走査して面ローカル座標の点群にする */
  _sampleTitleTargets() {
    const W = 600;
    const H = 200;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "800 120px system-ui, sans-serif";
    g.fillText(CFG.TITLE, W / 2, H * 0.5);

    const data = g.getImageData(0, 0, W, H).data;
    const pts = [];
    const step = 4;
    for (let y = 0; y < H; y += step) {
      for (let x = 0; x < W; x += step) {
        if (data[(y * W + x) * 4 + 3] > 110) {
          const u = x / W - 0.5;
          const v = 0.5 - y / H;
          pts.push(u * CFG.GLYPH_W, v * CFG.GLYPH_H + CFG.HEIGHT);
        }
      }
    }
    // シャッフルしてから DROPS 個へ間引く
    const m = pts.length / 2;
    for (let i = m - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      for (let k = 0; k < 2; k++) {
        const a = i * 2 + k;
        const b = j * 2 + k;
        const tmp = pts[a];
        pts[a] = pts[b];
        pts[b] = tmp;
      }
    }
    const keep = Math.min(CFG.DROPS, m);
    return new Float32Array(pts.slice(0, keep * 2));
  }

  _drawGlyphPanel() {
    this._panel.draw((c, w, h) => {
      c.textAlign = "center";
      c.textBaseline = "middle";
      const rg = c.createRadialGradient(w / 2, h * 0.42, 20, w / 2, h * 0.42, w * 0.5);
      rg.addColorStop(0, "rgba(8,12,22,0.42)");
      rg.addColorStop(1, "rgba(8,12,22,0)");
      c.fillStyle = rg;
      c.fillRect(0, 0, w, h);

      c.shadowColor = "#8fd0ff";
      c.shadowBlur = 30;
      c.fillStyle = CFG.TEXT;
      c.font = "800 150px system-ui, sans-serif";
      c.fillText(CFG.TITLE, w / 2, h * 0.42);

      c.shadowBlur = 10;
      c.fillStyle = "#9fb4d6";
      c.font = "500 40px system-ui, sans-serif";
      c.fillText(CFG.SUBTITLE, w / 2, h * 0.83);
    });
  }

  _resetSequence(hard) {
    this._phase = "FALL";
    this._phaseT = 0;
    this._done = false;
    for (const d of this._drop) {
      d.pos.set(
        (Math.random() * 2 - 1) * RAIN_RANGE.x,
        RAIN_RANGE.yBot + Math.random() * (RAIN_RANGE.yTop - RAIN_RANGE.yBot),
        RAIN_RANGE.zFar + Math.random() * (RAIN_RANGE.zNear - RAIN_RANGE.zFar)
      );
      d.speed = 0.8 + Math.random() * 0.9;
      d.len = 0.05 + Math.random() * 0.05;
      d.vel.set(0, 0, 0);
      d.bright = 0;
      if (hard) d.stagger = Math.random() * CFG.ASSEMBLE_STAGGER;
    }
    if (this._ring) this._ring.material.opacity = 0;
    if (this._panel) this._panel.mesh.material.opacity = 0;
    if (this._veil) this._veil.material.opacity = 0;
    this._mesh.material.opacity = 0.85;
  }

  _snapToHold() {
    this._phase = "HOLD";
    this._phaseT = 0;
    for (const d of this._drop) {
      if (d.tIndex >= 0) {
        d.pos.set(this._targets[d.tIndex * 2], this._targets[d.tIndex * 2 + 1], -CFG.DIST);
        d.bright = 1;
        d.len = 0.014;
      } else {
        d.pos.set(0, -99, 0); // 余り粒は隠す
      }
    }
    if (this._panel) this._panel.mesh.material.opacity = 0.9;
    if (this._veil) this._veil.material.opacity = 0;
  }

  update(dt, ctx) {
    const isStart = ctx.game?.state === "START";

    if (isStart && !this._wasStart) {
      this._resetSequence(false);
      if (REDUCED_MOTION) this._snapToHold();
    }
    if (!isStart && this._wasStart && this._phase !== "EXIT") {
      this._phase = "EXIT";
      this._phaseT = 0;
    }
    this._wasStart = isStart;

    const target = isStart || this._phase === "EXIT" ? 1 : 0;
    this._vis = REDUCED_MOTION ? target : THREE.MathUtils.damp(this._vis, target, 12, dt);
    const visible = this._vis > 0.01 || this._phase === "EXIT";
    this.group.visible = visible;
    if (!visible) return;

    this._t += dt;
    this._phaseT += dt;
    if (!REDUCED_MOTION) this._advance(dt);
    this._render();
  }

  _advance(dt) {
    const P = this._phase;

    if (P === "FALL") {
      for (const d of this._drop) {
        d.pos.y -= d.speed * dt;
        if (d.pos.y < RAIN_RANGE.yBot) {
          d.pos.y = RAIN_RANGE.yTop;
          d.pos.x = (Math.random() * 2 - 1) * RAIN_RANGE.x;
        }
      }
      if (this._phaseT >= CFG.FALL_SEC) {
        for (const d of this._drop) d.frozen.copy(d.pos);
        this._phase = "FREEZE";
        this._phaseT = 0;
        if (this._ring) {
          this._ring.material.opacity = 0.5;
          this._ring.scale.setScalar(0.15);
        }
      }
    } else if (P === "FREEZE") {
      if (this._ring) {
        const p = Math.min(1, this._phaseT / (CFG.FREEZE_SEC + 0.4));
        this._ring.scale.setScalar(0.15 + p * 3.4);
        this._ring.material.opacity = 0.5 * (1 - p) * this._vis;
      }
      if (this._phaseT >= CFG.FREEZE_SEC) {
        this._phase = "ASSEMBLE";
        this._phaseT = 0;
        if (this._ring) this._ring.material.opacity = 0;
      }
    } else if (P === "ASSEMBLE") {
      let allDone = true;
      for (const d of this._drop) {
        if (d.tIndex < 0) {
          this._tmpV.copy(d.pos).sub(this._center);
          if (this._tmpV.lengthSq() > 1e-6) this._tmpV.normalize();
          d.pos.addScaledVector(this._tmpV, 0.15 * dt);
          d.bright = Math.max(0, d.bright - dt * 0.7);
          continue;
        }
        const tx = this._targets[d.tIndex * 2];
        const ty = this._targets[d.tIndex * 2 + 1];
        const raw = (this._phaseT - d.stagger) / CFG.ASSEMBLE_SEC;
        const k = raw <= 0 ? 0 : raw >= 1 ? 1 : raw;
        if (k < 1) allDone = false;
        const e = easeOutBack(k);
        const s = smooth(k);
        d.pos.x = d.frozen.x + (tx - d.frozen.x) * e;
        d.pos.y = d.frozen.y + (ty - d.frozen.y) * e;
        d.pos.z = d.frozen.z + (-CFG.DIST - d.frozen.z) * s;
        d.len = 0.05 + (0.014 - 0.05) * s;
        d.bright = s;
      }
      if (this._panel) {
        this._panel.mesh.material.opacity =
          smooth(Math.min(1, this._phaseT / CFG.ASSEMBLE_SEC)) * 0.9;
      }
      if (this._veil) {
        this._veil.material.opacity =
          0.5 * (1 - smooth(Math.min(1, this._phaseT / (CFG.ASSEMBLE_SEC * 0.8)))) * this._vis;
      }
      if (allDone) {
        this._phase = "HOLD";
        this._phaseT = 0;
      }
    } else if (P === "HOLD") {
      if (this._veil) this._veil.material.opacity = 0;
      if (this._panel) {
        this._panel.mesh.material.opacity = 0.9;
        this._panel.mesh.position.y = CFG.HEIGHT + Math.sin(this._t * 0.9) * 0.01;
      }
      // 文字の粒がかすかに息づく
      for (const d of this._drop) {
        if (d.tIndex >= 0) d.bright = 0.85 + 0.15 * Math.sin(this._t * 3 + d.stagger * 20);
      }
    } else if (P === "EXIT") {
      for (const d of this._drop) {
        if (d.vel.lengthSq() === 0) {
          d.vel.set(
            (Math.random() * 2 - 1) * 0.5,
            -0.6 - Math.random() * 0.8,
            (Math.random() * 2 - 1) * 0.3
          );
        }
        d.pos.addScaledVector(d.vel, dt);
        d.bright = Math.max(0, d.bright - dt / CFG.EXIT_SEC);
      }
      const p = Math.min(1, this._phaseT / CFG.EXIT_SEC);
      this._mesh.material.opacity = 0.85 * (1 - p);
      if (this._panel) this._panel.mesh.material.opacity = 0.9 * (1 - p);
      this._vis = 1 - p;
      if (p >= 1) {
        this._done = true;
        this._resetSequence(false);
      }
    }
  }

  _render() {
    const dm = this._dummy;
    dm.quaternion.identity();
    for (let i = 0; i < this._drop.length; i++) {
      const d = this._drop[i];
      dm.position.copy(d.pos);
      dm.scale.set(1, Math.max(0.002, d.len), 1);
      dm.updateMatrix();
      this._mesh.setMatrixAt(i, dm.matrix);
      this._tmpC.copy(this._rainC).lerp(this._glyphC, THREE.MathUtils.clamp(d.bright, 0, 1));
      this._mesh.setColorAt(i, this._tmpC);
    }
    this._mesh.instanceMatrix.needsUpdate = true;
    if (this._mesh.instanceColor) this._mesh.instanceColor.needsUpdate = true;
    if (this._phase !== "EXIT") {
      this._mesh.material.opacity = 0.85 * (0.4 + 0.6 * this._vis);
    }
  }

  dispose() {
    this.camera.remove(this.group);
    this._mesh.geometry.dispose();
    this._mesh.material.dispose();
    if (this._ring) {
      this._ring.geometry.dispose();
      this._ring.material.dispose();
    }
    if (this._panel) this._panel.dispose();
    if (this._veil) {
      this._veil.geometry.dispose();
      this._veil.material.dispose();
    }
  }
}

function smooth(x) {
  return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
}
function easeOutBack(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
