import * as THREE from "three";
import { createPanel } from "./_panel.js";

const REDUCED_MOTION =
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// 見た目・文言の調整はここ。
const CFG = {
  TITLE: "雨避け",
  SUBTITLE: "― 妄想の雨 ―",
  TEXT: "#eaf1ff",
  ACCENT: "#7cc4ff",
  PARTICLE_COLOR: 0xbcd6ff,
  PARTICLES: 140,
  GATHER_ON_START: true, // START 突入時、雨粒がタイトルへ吸い寄せられて散る演出
  FLOOR_RING: true, // 足元に広がる波紋リング
  BOB: true, // タイトルのゆらゆら
  DIST: 1.95, // カメラからタイトルまでの距離(m)
  HEIGHT: 0.33 // タイトルの高さオフセット(m)
};

/**
 * タイトル画面（START 状態のときだけ表示する視界追従の演出レイヤー）。
 *
 * StartScreen（「トリガーで開始」の操作パネル）とは独立。こちらは装飾専用で
 * ゲームへの入力は持たない。START に入るとフェードインし、ゆっくり降る雨粒と
 * 浮かぶタイトル、足元の波紋を出す。GATHER_ON_START が true なら、START に
 * 入った瞬間だけ雨粒がタイトルへ集まってから散る（「妄想が像を結ぶ」イメージ）。
 * START を離れると 0.4 秒でフェードアウトする。
 *
 * presentation 内で完結。core へは触れず ctx.game.state を読むだけ。
 */
export class TitleScreen {
  constructor(scene, ctx) {
    this.scene = scene;
    this.camera = ctx.camera;
    this.game = ctx.game;

    this._t = 0;
    this._vis = 0; // 表示のフェード 0..1
    this._gather = 0; // 集合演出 0..1（START 突入で 1 → 減衰）
    this._wasStart = false;

    this.group = new THREE.Group();
    this.camera.add(this.group);

    // --- タイトル文字（CanvasTexture パネル・不透明背景は置かない）---
    this.panel = createPanel({
      worldWidth: 1.5,
      worldHeight: 0.62,
      pxWidth: 900,
      pxHeight: 372
    });
    this.panel.mesh.position.set(0, CFG.HEIGHT, -CFG.DIST);
    this.panel.draw((c, w, h) => {
      c.textAlign = "center";
      c.textBaseline = "middle";
      // タイトルの後ろだけ、ふわっと暗く（縁は透過のまま＝パススルーが見える）
      const g = c.createRadialGradient(w / 2, h * 0.42, 20, w / 2, h * 0.42, w * 0.5);
      g.addColorStop(0, "rgba(8,12,22,0.5)");
      g.addColorStop(1, "rgba(8,12,22,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);

      c.shadowColor = CFG.ACCENT;
      c.shadowBlur = 36;
      c.fillStyle = CFG.TEXT;
      c.font = "800 150px system-ui, sans-serif";
      c.fillText(CFG.TITLE, w / 2, h * 0.4);

      c.shadowBlur = 12;
      c.fillStyle = "#9fb4d6";
      c.font = "500 40px system-ui, sans-serif";
      c.fillText(CFG.SUBTITLE, w / 2, h * 0.8);
    });
    this._titleBaseY = CFG.HEIGHT;
    this.group.add(this.panel.mesh);

    // --- 雨粒（Points）---
    this._range = { x: 1.0, yTop: 1.1, yBot: -0.35, zNear: -1.4, zFar: -2.5 };
    const n = CFG.PARTICLES;
    this._pos = new Float32Array(n * 3); // 落下中の「素」の位置（描画位置とは別に保持）
    this._speed = new Float32Array(n);
    this._phase = new Float32Array(n); // 集合演出の個体差
    for (let i = 0; i < n; i++) this._respawnParticle(i, true);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this._pos.slice(), 3));
    this._points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: CFG.PARTICLE_COLOR,
        size: 0.02,
        sizeAttenuation: true,
        map: makeDropTexture(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        toneMapped: false
      })
    );
    this._points.frustumCulled = false;
    this._points.renderOrder = 9998;
    this.group.add(this._points);

    // --- 足元の波紋（scene 空間・ワールド原点付近）---
    this._ring = null;
    if (CFG.FLOOR_RING) {
      this._ring = new THREE.Mesh(
        new THREE.RingGeometry(0.28, 0.32, 48),
        new THREE.MeshBasicMaterial({
          color: CFG.ACCENT,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false
        })
      );
      this._ring.rotation.x = -Math.PI / 2;
      this._ring.position.set(0, 0.02, 0);
      this._ring.renderOrder = 1;
      this.scene.add(this._ring);
    }

    // 使い回し
    this._center = new THREE.Vector3();
  }

  _respawnParticle(i, anywhere) {
    const r = this._range;
    this._pos[i * 3] = (Math.random() * 2 - 1) * r.x;
    this._pos[i * 3 + 1] = anywhere
      ? r.yBot + Math.random() * (r.yTop - r.yBot)
      : r.yTop;
    this._pos[i * 3 + 2] = r.zFar + Math.random() * (r.zNear - r.zFar);
    this._speed[i] = 0.18 + Math.random() * 0.22;
    this._phase[i] = Math.random();
  }

  update(dt, ctx) {
    const isStart = ctx.game?.state === "START";

    // フェード
    const target = isStart ? 1 : 0;
    this._vis = REDUCED_MOTION
      ? target
      : THREE.MathUtils.damp(this._vis, target, 10, dt);

    // START 突入で集合演出をトリガー
    if (isStart && !this._wasStart && CFG.GATHER_ON_START && !REDUCED_MOTION) {
      this._gather = 1;
    }
    this._wasStart = isStart;
    this._gather = Math.max(0, this._gather - dt / 1.6);

    const visible = this._vis > 0.01;
    this.group.visible = visible;
    if (this._ring) this._ring.visible = visible && !!CFG.FLOOR_RING;
    if (!visible) return;

    this._t += dt;

    // タイトルのゆらぎ
    if (CFG.BOB && !REDUCED_MOTION) {
      this.panel.mesh.position.y = this._titleBaseY + Math.sin(this._t * 0.9) * 0.015;
      this.panel.mesh.rotation.z = Math.sin(this._t * 0.5) * 0.012;
    }
    this.panel.mesh.material.opacity = this._vis;

    // 雨粒の更新（落下 → 上端で再出現）。集合演出中はタイトル中心へ寄せる。
    this._center.set(0, this._titleBaseY, -CFG.DIST);
    const g = ease(this._gather);
    const attr = this._points.geometry.attributes.position;
    const n = CFG.PARTICLES;
    for (let i = 0; i < n; i++) {
      let y = this._pos[i * 3 + 1] - this._speed[i] * dt;
      if (y < this._range.yBot) {
        this._respawnParticle(i, false);
        y = this._pos[i * 3 + 1];
      } else {
        this._pos[i * 3 + 1] = y;
      }
      const px = this._pos[i * 3];
      const pz = this._pos[i * 3 + 2];
      // 個体ごとに寄せ具合をずらして「像を結ぶ」感じに
      const k = g * (0.35 + 0.65 * this._phase[i]);
      attr.array[i * 3] = px + (this._center.x - px) * k;
      attr.array[i * 3 + 1] = y + (this._center.y - y) * k;
      attr.array[i * 3 + 2] = pz + (this._center.z - pz) * k;
    }
    attr.needsUpdate = true;
    this._points.material.opacity = this._vis * (0.5 + 0.4 * g);

    // 足元の波紋（ゆっくり広がって消えるループ）
    if (this._ring) {
      const p = (this._t * 0.35) % 1;
      const s = 0.6 + p * 2.2;
      this._ring.scale.set(s, s, s);
      this._ring.material.opacity = this._vis * 0.28 * (1 - p);
    }
  }

  dispose() {
    this.camera.remove(this.group);
    this.panel.dispose();
    this._points.geometry.dispose();
    this._points.material.map?.dispose();
    this._points.material.dispose();
    if (this._ring) {
      this.scene.remove(this._ring);
      this._ring.geometry.dispose();
      this._ring.material.dispose();
    }
  }
}

/** 0..1 を滑らかに（ease-in-out） */
function ease(x) {
  return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
}

/** 雨粒スプライト用の柔らかい円テクスチャ */
function makeDropTexture() {
  const s = 64;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  const rg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  rg.addColorStop(0, "rgba(255,255,255,1)");
  rg.addColorStop(0.4, "rgba(255,255,255,0.65)");
  rg.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = rg;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
