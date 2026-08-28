import * as THREE from "three";

/**
 * リプレイの「速さ」を演出で盛るモジュール（審査フィードバック：もっとカッコよく／
 * モーションブラー的・スピード感・“マトリックスみ”）。REPLAY 状態のときだけ働く。
 *
 * 依存は ctx.replayer / ctx.camera / ctx.game のみ（読むだけ）。
 * PlayerAvatar / RainRenderer / core には一切触らない（別モジュールとして重ねる）。
 *
 * 効果:
 *  1) スピード線     … カメラ追従の集中線。開始直後に強く出て以降は薄く脈動
 *  2) 突入の一撃     … リプレイ開始の瞬間、白フラッシュ＋広がるリング＋ビネット
 *  3) アバター残像   … 記録された頭・両手の軌跡を、加算ブレンドの小球で尾を引かせる
 *
 * 調整は下の CFG。実機で数値を詰める前提（描画はこの環境で確認できないため）。
 */

const REDUCED_MOTION =
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const CFG = {
  // --- スピード線 ---
  LINES_ENABLED: true,
  LINE_COUNT: 64,
  LINES_RAMP: 0.35, // 秒。開始からこの時間で最大へ
  LINES_PEAK: REDUCED_MOTION ? 0.12 : 0.42, // 最大不透明度
  LINES_IDLE: REDUCED_MOTION ? 0.05 : 0.14, // 定常の不透明度
  LINES_PULSE_HZ: 0.8,
  LINE_COLOR: "#dff2ff",

  // --- 突入の一撃（one-shot） ---
  PUNCH_ENABLED: !REDUCED_MOTION,
  FLASH_DUR: 0.22,
  FLASH_OPACITY: 0.5,
  RING_DUR: 0.42,
  RING_FROM: 0.25,
  RING_TO: 3.2,
  VIGNETTE_DUR: 0.5,
  VIGNETTE_OPACITY: 0.5,

  // --- アバター残像 ---
  TRAIL_ENABLED: true,
  TRAIL_LEN: 12, // 何フレーム分たどるか
  TRAIL_HEAD_SIZE: 0.07,
  TRAIL_HAND_SIZE: 0.045,
  TRAIL_COLOR: new THREE.Color(0x8fe6ff),
  TRAIL_MIN_FACTOR: 0.28 // 一番古い残像の縮小・減光率
};

/** 中心から放射状に伸びる集中線のテクスチャ（中央は抜く）。 */
function makeSpeedLineTexture(px, count, colorCss) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = px;
  const c = cv.getContext("2d");
  const cx = px / 2;
  const cy = px / 2;
  c.strokeStyle = colorCss;
  c.lineCap = "round";
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.15;
    const inner = px * (0.30 + Math.random() * 0.10);
    const outer = px * (0.48 + Math.random() * 0.02);
    c.globalAlpha = 0.25 + Math.random() * 0.6;
    c.lineWidth = 1 + Math.random() * 3;
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    c.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
    c.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 縁が暗いビネット（中央は透明）。 */
function makeVignetteTexture(px) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = px;
  const c = cv.getContext("2d");
  const g = c.createRadialGradient(px / 2, px / 2, px * 0.28, px / 2, px / 2, px * 0.52);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,1)");
  c.fillStyle = g;
  c.fillRect(0, 0, px, px);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** ソフトな輪（ショックウェーブ用）。 */
function makeRingTexture(px) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = px;
  const c = cv.getContext("2d");
  c.strokeStyle = "rgba(220,244,255,1)";
  c.shadowColor = "rgba(180,230,255,0.9)";
  c.shadowBlur = px * 0.04;
  c.lineWidth = px * 0.03;
  c.beginPath();
  c.arc(px / 2, px / 2, px * 0.42, 0, Math.PI * 2);
  c.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class ReplayFX {
  constructor(scene, ctx) {
    this.scene = scene;
    this.camera = ctx.camera;
    this.game = ctx.game;

    this._wasReplay = false;
    this._rt = 0; // リプレイ開始からの経過秒
    this._punchT = -1; // one-shot タイマー（<0 で無効）
    this._lastReplayer = undefined;
    this._buf = [[], [], []]; // head, handLeft, handRight の位置履歴

    this._disposables = [];

    // --- スピード線（カメラの子・平面） ---
    this._lineTex = makeSpeedLineTexture(512, CFG.LINE_COUNT, CFG.LINE_COLOR);
    this._lines = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.2),
      new THREE.MeshBasicMaterial({
        map: this._lineTex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        toneMapped: false
      })
    );
    this._lines.position.set(0, 0, -0.5);
    this._lines.renderOrder = 8000;
    this._lines.frustumCulled = false;
    this._lines.visible = false;
    this.camera.add(this._lines);
    this._disposables.push(this._lineTex, this._lines.geometry, this._lines.material);

    // --- 白フラッシュ（カメラの子・全面） ---
    this._flash = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        toneMapped: false
      })
    );
    this._flash.position.set(0, 0, -0.12);
    this._flash.renderOrder = 8500;
    this._flash.frustumCulled = false;
    this._flash.visible = false;
    this.camera.add(this._flash);
    this._disposables.push(this._flash.geometry, this._flash.material);

    // --- ビネット（カメラの子） ---
    this._vigTex = makeVignetteTexture(512);
    this._vig = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 3),
      new THREE.MeshBasicMaterial({
        map: this._vigTex,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        toneMapped: false
      })
    );
    this._vig.position.set(0, 0, -0.13);
    this._vig.renderOrder = 8400;
    this._vig.frustumCulled = false;
    this._vig.visible = false;
    this.camera.add(this._vig);
    this._disposables.push(this._vigTex, this._vig.geometry, this._vig.material);

    // --- ショックウェーブのリング（カメラの子） ---
    this._ringTex = makeRingTexture(256);
    this._ring = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: this._ringTex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        toneMapped: false
      })
    );
    this._ring.position.set(0, 0, -1.0);
    this._ring.renderOrder = 8600;
    this._ring.frustumCulled = false;
    this._ring.visible = false;
    this.camera.add(this._ring);
    this._disposables.push(this._ringTex, this._ring.geometry, this._ring.material);

    // --- アバター残像（ワールド・InstancedMesh） ---
    this._trailN = CFG.TRAIL_LEN * 3;
    this._trail = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 8, 6),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      }),
      this._trailN
    );
    this._trail.frustumCulled = false;
    this._trail.renderOrder = 2;
    this._trail.visible = false;
    this._trailDummy = new THREE.Object3D();
    this._trailCol = new THREE.Color();
    scene.add(this._trail);
    this._disposables.push(this._trail.geometry, this._trail.material);
  }

  _startPunch() {
    if (!CFG.PUNCH_ENABLED) return;
    this._punchT = 0;
    this._flash.visible = true;
    this._flash.material.opacity = CFG.FLASH_OPACITY;
    this._vig.visible = true;
    this._vig.material.opacity = 0;
    this._ring.visible = true;
    this._ring.material.opacity = 1;
    this._ring.scale.setScalar(CFG.RING_FROM);
  }

  _updatePunch(dt) {
    if (this._punchT < 0) return;
    this._punchT += dt;
    const t = this._punchT;

    // フラッシュ：opacity を線形に 0 へ
    const fk = Math.max(0, 1 - t / CFG.FLASH_DUR);
    this._flash.material.opacity = CFG.FLASH_OPACITY * fk;
    if (fk <= 0) this._flash.visible = false;

    // リング：拡大しながらフェード
    const rk = Math.min(1, t / CFG.RING_DUR);
    this._ring.scale.setScalar(CFG.RING_FROM + (CFG.RING_TO - CFG.RING_FROM) * rk);
    this._ring.material.opacity = 1 - rk;
    if (rk >= 1) this._ring.visible = false;

    // ビネット：0→peak→0
    const vk = Math.min(1, t / CFG.VIGNETTE_DUR);
    this._vig.material.opacity = Math.sin(vk * Math.PI) * CFG.VIGNETTE_OPACITY;
    if (vk >= 1) this._vig.visible = false;

    if (t > Math.max(CFG.FLASH_DUR, CFG.RING_DUR, CFG.VIGNETTE_DUR)) this._punchT = -1;
  }

  _updateLines() {
    if (!CFG.LINES_ENABLED) return;
    const ramp = Math.min(1, this._rt / CFG.LINES_RAMP);
    const pulse = 0.5 + 0.5 * Math.sin(this._rt * Math.PI * 2 * CFG.LINES_PULSE_HZ);
    const idle = CFG.LINES_IDLE * (0.7 + 0.3 * pulse);
    // 開始直後は PEAK、その後 idle へ落とす
    const op = idle + (CFG.LINES_PEAK - idle) * Math.pow(1 - ramp, 2);
    this._lines.visible = true;
    this._lines.material.opacity = op;
    this._lines.rotation.z += 0.0016; // ごくゆっくり回す
  }

  _readPoint(frame, key) {
    const p = frame && frame[key];
    if (!p) return null;
    return p;
  }

  _updateTrail(ctx) {
    if (!CFG.TRAIL_ENABLED) return;
    const frame = ctx.replayer?.frame;
    if (!frame) {
      this._trail.visible = false;
      return;
    }
    const keys = ["head", "handLeft", "handRight"];
    const sizes = [CFG.TRAIL_HEAD_SIZE, CFG.TRAIL_HAND_SIZE, CFG.TRAIL_HAND_SIZE];

    for (let k = 0; k < 3; k++) {
      const p = this._readPoint(frame, keys[k]);
      const buf = this._buf[k];
      if (p) {
        buf.push({ x: p.x, y: p.y, z: p.z });
        if (buf.length > CFG.TRAIL_LEN) buf.shift();
      }
    }

    this._trail.visible = true;
    let idx = 0;
    for (let k = 0; k < 3; k++) {
      const buf = this._buf[k];
      const base = sizes[k];
      for (let j = 0; j < CFG.TRAIL_LEN; j++) {
        // j=0 が最古。newest ほど大きく明るく。newest（buf 末尾）は本体と重なるので描かない。
        const has = j < buf.length - 1;
        if (has) {
          const age = (j + 1) / buf.length; // 0..1
          const f = CFG.TRAIL_MIN_FACTOR + (1 - CFG.TRAIL_MIN_FACTOR) * age;
          const pt = buf[j];
          this._trailDummy.position.set(pt.x, pt.y, pt.z);
          this._trailDummy.scale.setScalar(base * f);
          this._trailDummy.updateMatrix();
          this._trail.setMatrixAt(idx, this._trailDummy.matrix);
          this._trailCol.copy(CFG.TRAIL_COLOR).multiplyScalar(f * f);
          this._trail.setColorAt(idx, this._trailCol);
        } else {
          this._trailDummy.scale.setScalar(0);
          this._trailDummy.updateMatrix();
          this._trail.setMatrixAt(idx, this._trailDummy.matrix);
        }
        idx++;
      }
    }
    this._trail.instanceMatrix.needsUpdate = true;
    if (this._trail.instanceColor) this._trail.instanceColor.needsUpdate = true;
  }

  _hideAll() {
    this._lines.visible = false;
    this._flash.visible = false;
    this._vig.visible = false;
    this._ring.visible = false;
    this._trail.visible = false;
    this._punchT = -1;
    this._buf = [[], [], []];
  }

  update(dt, ctx) {
    const isReplay = ctx.game?.state === "REPLAY";

    if (isReplay && !this._wasReplay) {
      this._rt = 0;
      this._buf = [[], [], []];
      this._lastReplayer = ctx.replayer;
      this._startPunch();
    }
    if (!isReplay) {
      if (this._wasReplay) this._hideAll();
      this._wasReplay = false;
      return;
    }

    // 同一 REPLAY 中に replayer が差し替わったら履歴リセット（何度でも見返せる仕様）
    if (ctx.replayer !== this._lastReplayer) {
      this._lastReplayer = ctx.replayer;
      this._buf = [[], [], []];
      this._rt = 0;
    }

    this._wasReplay = true;
    this._rt += dt;

    this._updatePunch(dt);
    this._updateLines();
    this._updateTrail(ctx);
  }

  dispose() {
    this._hideAll();
    this.camera.remove(this._lines);
    this.camera.remove(this._flash);
    this.camera.remove(this._vig);
    this.camera.remove(this._ring);
    this.scene.remove(this._trail);
    for (const d of this._disposables) d?.dispose?.();
  }
}
