import * as THREE from "three";
import { createPanel } from "./_panel.js";

const REDUCED_MOTION =
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * タイトル演出「よけていた、つもりだった」。
 * START 状態のあいだだけ、プレイヤーの実際の部屋（ワールド空間）で再生する。
 * 状態機械・StartScreen・core は無変更（index.js に1モジュール足すだけ）。
 *
 *   SUSPEND   雨が降ってきて、床の手前で “止まる”。部屋じゅう（背面も）に宙吊りになる。
 *   PAINT     「手を動かして」。手/頭で宙の雨を払うと、当たった粒が押しのけられ光る。
 *   CONDENSE  宙の雨がこちら側へ湾曲した面に集まり、結露のようにタイトルを結ぶ。
 *             下に細い手書きで副題が一画ずつ書かれる。文字はときどき “しずく” を垂らす。
 *   HEARTBEAT タイトル以外の宙の雨が、一瞬だけ “本当の速さ” で落ちて、また止まる。
 *   HOLD      文字が息づき、手前の目隠しが晴れて StartScreen の「トリガーで開始」が読める。
 *   RELEASE   START を抜けると、粒がほどけて雨に戻りながら落ちて消える（＝ゲームの雨へ）。
 *
 * prefers-reduced-motion のときは即 HOLD（完成形を静止表示・HEARTBEAT なし）。
 */

const CFG = {
  TITLE: "雨避け",
  SUBTITLE: "よけていた、つもりだった。",

  RAIN_COLOR: 0xbcd6ff, // 宙吊り・降雨時
  GLYPH_COLOR: 0xf2f8ff, // 結露した文字
  WAKE_COLOR: 0xffffff, // 手で払われた粒の発光

  COUNT: 2400, // 粒の総数（InstancedMesh・CFG で調整）
  TITLE_FRAC: 0.46, // うちタイトル文字に使う割合
  SUB_FRAC: 0.24, // うち副題に使う割合（細いひらがなが潰れないよう多め。残りは部屋の雨）
  SUB_FAT: 1.9, // 副題の粒を太めに描く倍率（可読性）

  SUSPEND_SEC: 2.4,
  PAINT_SEC: 3.4,
  CONDENSE_SEC: 1.6, // 1粒あたりの集合時間
  CONDENSE_STAGGER: 0.6,
  SUB_REVEAL_SEC: 1.4, // 副題を左→右に書く時間
  HEARTBEAT_SEC: 0.42, // “本当の速さ”で落ちる時間
  RELEASE_SEC: 0.6,

  DIST: 1.95, // アンカーからタイトル面までの距離(m)
  HEIGHT: 0.28, // タイトル中心の高さ（目線からの相対, m）
  GLYPH_W: 1.55, // 文字が占める横幅(m)
  GLYPH_H: 0.44, // 縦(m)
  WRAP_GAIN: 1.0, // タイトル面の湾曲の強さ（1で自然、0で平面）
  GLASS_JITTER: 0.01, // 結露の厚み方向のばらつき(m)

  SUB_DROP_Y: -0.34, // 副題の中心（タイトル中心からの相対, m）
  SUB_W: 1.42,
  SUB_H: 0.17, // 縦を少し広げて細いひらがなの画をつぶさない
  SUB_TREMOR: 0.004, // 手書きの震え(m)

  ROOM: { x: 2.4, zFront: 2.6, zBack: 1.6, yBot: -1.5, yTop: 2.6 }, // 宙吊りの雨のワールド範囲（背面含む）
  SHIVER: 0.0018, // 宙吊り時の微振動(m)

  PAINT_RADIUS: 0.45, // 手が雨を払う半径(m)
  PAINT_PUSH: 3.6, // 払う強さ
  PAINT_RETURN: 0.9, // 払われた粒が定位置へ戻る速さ（小さいほど尾が残る）

  DRIP: true,
  DRIP_FRAC: 0.06, // しずくを垂らす文字粒の割合
  DRIP_AMOUNT: 0.05, // 垂れる距離(m)
  DRIP_PERIOD: 3.2, // 周期(s)

  REAL_SPEED: 7.0, // HEARTBEAT の落下速度(m/s)（RAIN_SPEED_REAL 相当）

  SHOCKWAVE: true, // HEARTBEAT のとき足元に走る波紋
  PROMPT_VEIL: true, // HOLD になるまで手前の開始プロンプトをうっすら隠す
  VEIL_COLOR: 0x0a0e16,
  SHOW_PAINT_PROMPT: true
};

const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, -1);

export class TitleScreen {
  constructor(scene, ctx) {
    this.scene = scene;
    this.camera = ctx.camera;
    this.game = ctx.game;
    this.controllers = ctx.controllers ?? [];

    this._t = 0;
    this._phase = "SUSPEND";
    this._phaseT = 0;
    this._wasStart = false;
    this._subReveal = 0;

    // ワールド空間（部屋）に置くもの
    this.world = new THREE.Group();
    this.scene.add(this.world);

    const n = CFG.COUNT;
    const geo = new THREE.CylinderGeometry(0.0042, 0.0042, 1, 5, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      toneMapped: false
    });
    this._mesh = new THREE.InstancedMesh(geo, mat, n);
    this._mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this._mesh.frustumCulled = false;
    this._mesh.renderOrder = 2;
    this.world.add(this._mesh);

    // 足元の波紋（HEARTBEAT）
    this._ring = null;
    if (CFG.SHOCKWAVE) {
      this._ring = new THREE.Mesh(
        new THREE.RingGeometry(0.86, 0.94, 64),
        new THREE.MeshBasicMaterial({
          color: CFG.RAIN_COLOR,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false
        })
      );
      this._ring.rotation.x = -Math.PI / 2;
      this._ring.renderOrder = 2;
      this.world.add(this._ring);
    }

    // カメラ子（視界追従）: 開始プロンプトの目隠し・「手を動かして」
    this.hud = new THREE.Group();
    this.camera.add(this.hud);

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
      this._veil.position.set(0, -0.02, -1.36);
      this._veil.renderOrder = 10050;
      this.hud.add(this._veil);
    }

    this._paintPanel = null;
    if (CFG.SHOW_PAINT_PROMPT) {
      this._paintPanel = createPanel({
        worldWidth: 0.5,
        worldHeight: 0.16,
        pxWidth: 420,
        pxHeight: 132
      });
      this._paintPanel.mesh.position.set(0, -0.32, -0.95);
      this._paintPanel.mesh.material.opacity = 0;
      this._paintPanel.draw((c, w, h) => {
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillStyle = "#cfe0ff";
        c.font = "600 56px system-ui, sans-serif";
        c.fillText("手を動かして", w / 2, h / 2);
      });
      this.hud.add(this._paintPanel.mesh);
    }

    // アンカー（START に入った瞬間のカメラ位置・ヨー）
    this._anchor = new THREE.Vector3();
    this._anchorYaw = new THREE.Quaternion();

    // グリフ目標（ワールド座標）
    this._titleTargets = null; // Float32Array xyz
    this._subTargets = null;

    // 粒の状態
    this._d = new Array(n);
    this._nTitle = Math.floor(n * CFG.TITLE_FRAC);
    this._nSub = Math.floor(n * CFG.SUB_FRAC);
    for (let i = 0; i < n; i++) {
      const role = i < this._nTitle ? "title" : i < this._nTitle + this._nSub ? "sub" : "room";
      this._d[i] = {
        role,
        home: new THREE.Vector3(),
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        tgt: new THREE.Vector3(),
        frozen: new THREE.Vector3(),
        len: 0.012,
        bright: 0,
        phase: Math.random() * 100,
        stagger: Math.random(),
        fallFrom: 1.5 + Math.random() * 3,
        drip: false,
        subU: 0
      };
    }
    for (let i = 0; i < this._nTitle; i++) {
      this._d[i].drip = CFG.DRIP && Math.random() < CFG.DRIP_FRAC;
    }

    // スクラッチ
    this._dummy = new THREE.Object3D();
    this._c = new THREE.Color();
    this._cRain = new THREE.Color(CFG.RAIN_COLOR);
    this._cGlyph = new THREE.Color(CFG.GLYPH_COLOR);
    this._cWake = new THREE.Color(CFG.WAKE_COLOR);
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._hands = [new THREE.Vector3(), new THREE.Vector3()];
    this._handCount = 0;

    this._vis = 0;
    this._built = false;
  }

  /** START に入った瞬間、アンカーを取り直して全目標・全ホームを組み直す */
  _build() {
    this.camera.updateWorldMatrix(true, false);
    this.camera.getWorldPosition(this._anchor);
    this.camera.getWorldQuaternion(this._q);
    this._v.copy(FWD).applyQuaternion(this._q);
    const yaw = Math.atan2(this._v.x, -this._v.z);
    this._anchorYaw.setFromAxisAngle(UP, yaw);

    this._titleTargets = this._sampleGlyph(CFG.TITLE, 120, CFG.GLYPH_W, CFG.GLYPH_H, CFG.HEIGHT, this._nTitle);
    this._subTargets = this._sampleGlyph(
      CFG.SUBTITLE,
      58,
      CFG.SUB_W,
      CFG.SUB_H,
      CFG.HEIGHT + CFG.SUB_DROP_Y,
      this._nSub
    );

    const R = CFG.ROOM;
    for (let i = 0; i < this._d.length; i++) {
      const d = this._d[i];
      // ホーム（宙吊り位置）= アンカー基準の部屋ボリューム内ランダム（背面も含む）
      const lx = (Math.random() * 2 - 1) * R.x;
      const lz = -(Math.random() * (R.zFront + R.zBack)) + R.zBack; // -zFront(前) .. +zBack(後)
      const ly = R.yBot + Math.random() * (R.yTop - R.yBot);
      this._localToWorld(lx, ly, lz, d.home);
      d.pos.copy(d.home);
      d.pos.y += d.fallFrom; // 上から降ってくる
      d.vel.set(0, 0, 0);
      d.bright = 0;
      d.len = 0.012;
      d.frozen.copy(d.pos);

      if (d.role === "title") {
        const k = (i % this._nTitle) % Math.max(1, this._titleTargets.length / 4);
        d.tgt.set(this._titleTargets[k * 4], this._titleTargets[k * 4 + 1], this._titleTargets[k * 4 + 2]);
        d.subU = 0;
      } else if (d.role === "sub") {
        const cnt = Math.max(1, this._subTargets.length / 4);
        const k = (i - this._nTitle) % cnt;
        d.tgt.set(this._subTargets[k * 4], this._subTargets[k * 4 + 1], this._subTargets[k * 4 + 2]);
        d.subU = this._subTargets[k * 4 + 3];
      }
    }

    if (this._ring) this._ring.position.set(this._anchor.x, this._anchor.y - 1.5, this._anchor.z);
    this._phase = "SUSPEND";
    this._phaseT = 0;
    this._subReveal = 0;
    this._paintFade = 0.9;
    if (this._veil) this._veil.material.opacity = 0;
    if (this._paintPanel) this._paintPanel.mesh.material.opacity = 0;
    if (this._ring) this._ring.material.opacity = 0;
    this._mesh.material.opacity = 0.9;
    this._built = true;

    if (REDUCED_MOTION) this._snapToHold();
  }

  /** アンカー基準ローカル(x,y は目線相対 / z は前方が負) → ワールド */
  _localToWorld(lx, ly, lz, out) {
    out.set(lx, ly, lz).applyQuaternion(this._anchorYaw).add(this._anchor);
    return out;
  }

  /**
   * text をオフスクリーンに描き、アルファを格子走査して
   * 「こちら側へ湾曲した面」（半径 DIST の円弧、中心を正面 -DIST に）上の
   * ワールド目標点にする。返り値: Float32Array、1点 = [x, y, z, u01]（u01 は左右位置 0..1）。
   */
  _sampleGlyph(text, fontPx, worldW, worldH, yOffset, cap) {
    const W = 900;
    const H = Math.max(80, Math.round(fontPx * 1.9));
    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const g = cv.getContext("2d");
    g.fillStyle = "#fff";
    g.strokeStyle = "#fff";
    g.lineJoin = "round";
    g.lineWidth = fontPx * 0.09; // 細い画（ひらがなの「よ」等）を太らせてから点群化する
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `800 ${fontPx}px system-ui, sans-serif`;
    g.strokeText(text, W / 2, H / 2);
    g.fillText(text, W / 2, H / 2);
    const data = g.getImageData(0, 0, W, H).data;

    const hits = [];
    let minX = W, maxX = 0, minY = H, maxY = 0;
    const step = 3;
    for (let y = 0; y < H; y += step) {
      for (let x = 0; x < W; x += step) {
        if (data[(y * W + x) * 4 + 3] > 110) {
          hits.push(x, y);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (hits.length === 0) return new Float32Array(0);
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);

    const m = hits.length / 2;
    for (let i = m - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      for (let k = 0; k < 2; k++) {
        const a = i * 2 + k;
        const b = j * 2 + k;
        const t = hits[a];
        hits[a] = hits[b];
        hits[b] = t;
      }
    }

    const keep = Math.min(cap, m);
    const R = CFG.DIST;
    const out = new Float32Array(keep * 4);
    for (let i = 0; i < keep; i++) {
      const px = hits[i * 2];
      const py = hits[i * 2 + 1];
      const u01 = (px - minX) / bw; // 0..1（左→右）
      const v01 = (py - minY) / bh; // 0..1（上→下）
      const phi = (((u01 - 0.5) * worldW) / R) * CFG.WRAP_GAIN;
      const rr = R + (Math.random() * 2 - 1) * CFG.GLASS_JITTER;
      const lx = rr * Math.sin(phi);
      const ly = (0.5 - v01) * worldH + yOffset;
      const lz = -rr * Math.cos(phi); // phi=0 で -DIST、両端は少し手前へ湾曲
      this._localToWorld(lx, ly, lz, this._v);
      out[i * 4] = this._v.x;
      out[i * 4 + 1] = this._v.y;
      out[i * 4 + 2] = this._v.z;
      out[i * 4 + 3] = u01;
    }
    return out;
  }

  _snapToHold() {
    this._phase = "HOLD";
    this._phaseT = 0;
    this._subReveal = 1;
    for (const d of this._d) {
      if (d.role === "room") {
        d.pos.copy(d.home);
        d.bright = 0.15;
        d.len = 0.012;
      } else {
        d.pos.copy(d.tgt);
        d.bright = 1;
        d.len = 0.012;
      }
    }
    if (this._veil) this._veil.material.opacity = 0;
    if (this._paintPanel) this._paintPanel.mesh.material.opacity = 0;
  }

  _readHands() {
    this._handCount = 0;
    for (const c of this.controllers) {
      if (c && c.userData && c.userData.connected) {
        c.getWorldPosition(this._hands[this._handCount]);
        if (++this._handCount >= 2) break;
      }
    }
    if (this._handCount === 0) {
      // フォールバック: 合成した「手」を宙の雨の中で大きく動かす（ハーネス確認用）
      this._localToWorld(
        0.75 * Math.sin(this._t * 1.3),
        0.35 + 0.7 * Math.sin(this._t * 1.9),
        -1.1 + 0.55 * Math.cos(this._t * 0.9),
        this._hands[0]
      );
      this._handCount = 1;
    }
  }

  update(dt, ctx) {
    const isStart = ctx.game?.state === "START";

    if (isStart && !this._wasStart) this._build();
    if (!isStart && this._wasStart && this._phase !== "RELEASE" && this._built) {
      this._phase = "RELEASE";
      this._phaseT = 0;
    }
    this._wasStart = isStart;
    if (!this._built) {
      this.world.visible = false;
      return;
    }

    const showTarget = isStart || this._phase === "RELEASE" ? 1 : 0;
    this._vis = REDUCED_MOTION ? showTarget : THREE.MathUtils.damp(this._vis, showTarget, 12, dt);
    const visible = this._vis > 0.01 || this._phase === "RELEASE";
    this.world.visible = visible;
    this.hud.visible = visible;
    if (!visible) return;

    this._t += dt;
    this._phaseT += dt;
    if (!REDUCED_MOTION) {
      this._readHands();
      this._advance(dt);
    }
    this._render();
  }

  _advance(dt) {
    const P = this._phase;
    const step = (p) => (p <= 0 ? 0 : p >= 1 ? 1 : p * p * (3 - 2 * p));

    if (P === "SUSPEND") {
      for (const d of this._d) {
        const p = step((this._phaseT - d.stagger * (CFG.SUSPEND_SEC * 0.6)) / (CFG.SUSPEND_SEC * 0.4));
        d.pos.set(d.home.x, d.home.y + d.fallFrom * (1 - p), d.home.z);
        d.len = 0.05 + (0.012 - 0.05) * p;
        d.bright = 0.1 + 0.15 * p;
        this._shiver(d, p);
      }
      if (this._paintPanel) {
        this._paintPanel.mesh.material.opacity =
          step((this._phaseT - CFG.SUSPEND_SEC * 0.6) / (CFG.SUSPEND_SEC * 0.4)) * 0.9;
      }
      if (this._veil) this._veil.material.opacity = 0.5 * this._vis;
      if (this._phaseT >= CFG.SUSPEND_SEC) {
        this._phase = "PAINT";
        this._phaseT = 0;
      }
    } else if (P === "PAINT") {
      this._paint(dt);
      for (const d of this._d) this._shiver(d, 1);
      if (this._veil) this._veil.material.opacity = 0.5 * this._vis;
      if (this._phaseT >= CFG.PAINT_SEC) {
        this._phase = "CONDENSE";
        this._phaseT = 0;
        for (const d of this._d) d.frozen.copy(d.pos);
        if (this._paintPanel) this._paintFade = this._paintPanel.mesh.material.opacity;
      }
    } else if (P === "CONDENSE") {
      let done = true;
      for (const d of this._d) {
        if (d.role === "room") {
          this._shiver(d, 1);
          d.bright = Math.max(0.12, d.bright - dt * 0.3);
          continue;
        }
        const raw = (this._phaseT - d.stagger * CFG.CONDENSE_STAGGER) / CFG.CONDENSE_SEC;
        const k = raw <= 0 ? 0 : raw >= 1 ? 1 : raw;
        if (k < 1) done = false;
        if (d.role === "sub" && d.subU > this._subReveal) {
          d.bright = 0;
          d.len = 0;
          continue;
        }
        const e = easeOutBack(k);
        const s = step(k);
        const f = d.frozen || d.home;
        d.pos.set(
          f.x + (d.tgt.x - f.x) * e,
          f.y + (d.tgt.y - f.y) * e,
          f.z + (d.tgt.z - f.z) * s
        );
        d.len = 0.05 + (0.012 - 0.05) * s;
        d.bright = d.role === "sub" ? 0.85 * s : s;
      }
      this._subReveal = Math.min(1, this._phaseT / CFG.SUB_REVEAL_SEC);
      if (this._paintPanel) {
        this._paintPanel.mesh.material.opacity =
          (this._paintFade ?? 0.9) * (1 - step(this._phaseT / 0.5));
      }
      if (this._veil) {
        this._veil.material.opacity = 0.5 * (1 - step(this._phaseT / (CFG.CONDENSE_SEC * 0.7))) * this._vis;
      }
      if (done && this._subReveal >= 1) {
        this._phase = "HEARTBEAT";
        this._phaseT = 0;
        if (this._ring) {
          this._ring.material.opacity = 0.55;
          this._ring.scale.setScalar(0.2);
        }
        for (const d of this._d) {
          if (d.role === "room") d.vel.set(0, -CFG.REAL_SPEED, 0);
        }
      }
    } else if (P === "HEARTBEAT") {
      for (const d of this._d) {
        if (d.role === "room") {
          d.pos.addScaledVector(d.vel, dt);
          d.len = 0.42;
          d.bright = 0.7;
          if (d.pos.y < this._anchor.y + CFG.ROOM.yBot) {
            // 抜けたら再び宙吊りへ（新しいホーム）
            d.pos.y = this._anchor.y + CFG.ROOM.yTop;
            d.home.copy(d.pos);
          }
        }
      }
      if (this._ring) {
        const p = Math.min(1, this._phaseT / (CFG.HEARTBEAT_SEC + 0.5));
        this._ring.scale.setScalar(0.2 + p * 4.2);
        this._ring.material.opacity = 0.55 * (1 - p) * this._vis;
      }
      if (this._phaseT >= CFG.HEARTBEAT_SEC) {
        for (const d of this._d) {
          if (d.role === "room") {
            d.vel.set(0, 0, 0);
            d.home.copy(d.pos);
            d.len = 0.012;
          }
        }
        if (this._ring) this._ring.material.opacity = 0;
        this._phase = "HOLD";
        this._phaseT = 0;
      }
    } else if (P === "HOLD") {
      if (this._veil) this._veil.material.opacity = 0;
      if (this._ring) this._ring.material.opacity = 0;
      for (const d of this._d) {
        if (d.role === "room") {
          this._shiver(d, 1);
          d.bright = 0.12 + 0.03 * Math.sin(this._t * 0.7 + d.phase);
        } else {
          d.pos.copy(d.tgt);
          if (d.drip) {
            const pp = ((this._t + d.phase) % CFG.DRIP_PERIOD) / CFG.DRIP_PERIOD;
            d.pos.y -= CFG.DRIP_AMOUNT * dripCurve(pp);
          }
          d.bright = 0.82 + 0.18 * Math.sin(this._t * 3 + d.phase * 5);
        }
      }
    } else if (P === "RELEASE") {
      for (const d of this._d) {
        if (d.vel.lengthSq() === 0) {
          d.vel.set((Math.random() * 2 - 1) * 0.4, -1.1 - Math.random() * 1.2, (Math.random() * 2 - 1) * 0.3);
        }
        d.pos.addScaledVector(d.vel, dt);
        d.len = Math.min(0.3, d.len + dt * 0.8);
        d.bright = Math.max(0, d.bright - dt / CFG.RELEASE_SEC);
      }
      const p = Math.min(1, this._phaseT / CFG.RELEASE_SEC);
      this._mesh.material.opacity = 0.9 * (1 - p);
      this._vis = 1 - p;
      if (p >= 1) {
        this._built = false;
        this._mesh.material.opacity = 0.9;
        for (const d of this._d) d.vel.set(0, 0, 0);
      }
    }
  }

  _shiver(d, amt) {
    if (amt <= 0) return;
    const s = CFG.SHIVER * amt;
    d.pos.x += s * Math.sin(this._t * 6.1 + d.phase * 3.3);
    d.pos.y += s * Math.sin(this._t * 7.7 + d.phase * 1.7);
    d.pos.z += s * Math.sin(this._t * 5.3 + d.phase * 2.9);
  }

  _paint(dt) {
    for (const d of this._d) {
      let pushed = false;
      for (let hi = 0; hi < this._handCount; hi++) {
        const hand = this._hands[hi];
        const dist = d.pos.distanceTo(hand);
        if (dist < CFG.PAINT_RADIUS) {
          this._v.copy(d.pos).sub(hand);
          if (this._v.lengthSq() < 1e-8) this._v.set(0, 1, 0);
          this._v.normalize();
          const near = 1 - dist / CFG.PAINT_RADIUS;
          d.pos.addScaledVector(this._v, near * CFG.PAINT_PUSH * dt);
          d.bright = Math.min(1.6, d.bright + near * 12 * dt);
          d.len = Math.min(0.07, d.len + near * 0.9 * dt);
          pushed = true;
        }
      }
      if (!pushed) {
        d.pos.lerp(d.home, Math.min(1, CFG.PAINT_RETURN * dt));
        d.bright = Math.max(0.12, d.bright - dt * 0.7);
        d.len = Math.max(0.012, d.len - dt * 0.06);
      }
    }
  }

  _render() {
    const dm = this._dummy;
    dm.quaternion.identity();
    for (let i = 0; i < this._d.length; i++) {
      const d = this._d[i];
      if (d.len <= 0.003) {
        dm.position.set(0, -9999, 0); // 未表示（未書きの副題粒など）
        dm.scale.set(0, 0, 0);
      } else {
        dm.position.copy(d.pos);
        const fat = d.role === "sub" ? CFG.SUB_FAT : 1;
        dm.scale.set(fat, d.len, fat);
      }
      dm.updateMatrix();
      this._mesh.setMatrixAt(i, dm.matrix);
      // 色: rain -> glyph（明るさで）＋ wake（1超で白へ）
      const b = d.bright;
      if (b > 1) {
        this._c.copy(this._cGlyph).lerp(this._cWake, Math.min(1, b - 1));
      } else {
        this._c.copy(this._cRain).lerp(this._cGlyph, Math.max(0, b));
      }
      this._mesh.setColorAt(i, this._c);
    }
    this._mesh.instanceMatrix.needsUpdate = true;
    if (this._mesh.instanceColor) this._mesh.instanceColor.needsUpdate = true;
    if (this._phase !== "RELEASE") {
      this._mesh.material.opacity = 0.9 * (0.35 + 0.65 * this._vis);
    }
  }

  dispose() {
    this.scene.remove(this.world);
    this.camera.remove(this.hud);
    this._mesh.geometry.dispose();
    this._mesh.material.dispose();
    if (this._ring) {
      this._ring.geometry.dispose();
      this._ring.material.dispose();
    }
    if (this._veil) {
      this._veil.geometry.dispose();
      this._veil.material.dispose();
    }
    if (this._paintPanel) this._paintPanel.dispose();
  }
}

function easeOutBack(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const c1 = 1.3;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
/** 0..1: すばやく1へ（垂れる）→ ゆっくり0へ（戻る） */
function dripCurve(p) {
  const s = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  return p < 0.18 ? s(p / 0.18) : 1 - s((p - 0.18) / 0.82);
}
