import * as THREE from "three";

const REDUCED_MOTION =
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * タイトル演出「よけていた、つもりだった」。
 * START のあいだ、プレイヤーの実際の部屋（ワールド空間・背面含む）で再生する。
 * 状態機械・StartScreen・core は無変更（index.js に1モジュール足すだけ）。
 *
 *   SUSPEND   雨が降ってきて床の手前で止まり、部屋じゅうに宙吊りになる
 *   PAINT     手/頭で宙の雨を払うと、当たった粒が押しのけられ発光しながら尾を引く
 *   CONDENSE  宙の雨がタイトルの“水膜”へ流れ込み、粒が着弾するたび波紋が走って
 *             左→右へ液体の文字が満ちていく。文字は本物のグリフ形なので必ず読める。
 *             膜は絶えずうねり、縁がメニスカスのように光り、下端からしずくが垂れる。
 *   HEARTBEAT タイトル以外の宙の雨が、一瞬(0.42s)だけ“本当の速さ”(7m/s)で落ちて、また止まる
 *   HOLD      水膜が息づき、手前の目隠しが晴れて StartScreen の「トリガーで開始」が読める
 *   RELEASE   START を抜けると水膜が崩れ、粒がほどけて雨に戻りながら落ちて消える
 *
 * prefers-reduced-motion のときは即 HOLD（完成形を静止表示）。
 */

const CFG = {
  TITLE: "雨避け",
  SUBTITLE: "よけていた、つもりだった。",

  DEEP: 0x3f7fbf, // 液体の濃い所
  BRIGHT: 0xeaf6ff, // ハイライト
  RIM: 0xffffff, // 縁・波紋の先端
  RAIN_COLOR: 0xbcd6ff, // 宙吊り・降雨の粒
  WAKE_COLOR: 0xffffff, // 払われた粒の発光

  COUNT: 2000, // 粒の総数（宙の雨＋水膜へ流し込むフィーダー）
  FEED_FRAC: 0.5, // うち水膜へ流し込む割合（残りは部屋の雨）
  FEED_TITLE_BIAS: 0.78, // フィーダーのうちタイトルへ向かう割合（残りは副題へ）

  SUSPEND_SEC: 2.4,
  PAINT_SEC: 3.2,
  CONDENSE_SEC: 2.0, // 水膜が満ちるまで
  HEARTBEAT_SEC: 0.42,
  RELEASE_SEC: 0.6,

  DIST: 1.95, // アンカーからタイトル面までの距離(m)
  TITLE_Y: 0.3, // タイトル中心の高さ（目線相対, m）
  TITLE_W: 1.55,
  TITLE_H: 0.46,
  SUB_Y: -0.36, // 副題中心（タイトル中心からの相対, m）
  SUB_W: 1.5,
  SUB_H: 0.15,
  WRAP_GAIN: 1.0, // 面の湾曲（1で自然、0で平面）

  // 液体シェーダの効き（マシマシ用ノブ）
  LIQ_WOBBLE: 1.0, // うねりの強さ
  LIQ_RIM: 1.0, // 縁の光の強さ
  LIQ_CAUSTIC: 1.0, // 内側の動く明るいムラ
  RIPPLE_STRENGTH: 1.0, // 着弾波紋の強さ

  DRIPS: 12, // しずくの数（タイトル＋副題合計）
  DRIP_FALL: 0.12, // しずくの落下距離(m)
  DRIP_PERIOD: [1.6, 3.6], // しずくの周期(s) 範囲

  ROOM: { x: 2.4, zFront: 2.6, zBack: 1.6, yBot: -1.5, yTop: 2.6 },
  SHIVER: 0.0018,
  PAINT_RADIUS: 0.45,
  PAINT_PUSH: 3.6,
  PAINT_RETURN: 0.9,
  REAL_SPEED: 7.0,

  SHOCKWAVE: true,
  PROMPT_VEIL: true,
  VEIL_COLOR: 0x0a0e16
};

const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, -1);
const N_IMPACT = 12; // シェーダに渡す同時波紋数

const LIQUID_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const LIQUID_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uGlyph;
  uniform float uTime, uFill, uOpacity, uWobble, uRimK, uCaustic, uRippleK;
  uniform vec3 uDeep, uBright, uRim;
  uniform vec3 uImpacts[${N_IMPACT}];

  float gA(vec2 uv){
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    return texture2D(uGlyph, uv).a;
  }
  void main(){
    vec2 uv = vUv;
    float t = uTime;

    vec2 warp = vec2(
      sin(uv.y*22.0 + t*1.7) + 0.6*sin(uv.x*13.0 - t*1.1),
      sin(uv.x*18.0 - t*1.3) + 0.6*sin(uv.y*15.0 + t*0.9)
    ) * 0.006 * uWobble;

    float ripple = 0.0;
    for (int i = 0; i < ${N_IMPACT}; i++) {
      vec3 im = uImpacts[i];
      if (im.z < 0.0) continue;
      float age = t - im.z;
      if (age < 0.0 || age > 1.7) continue;
      float d = distance(uv, im.xy);
      ripple += sin(d*90.0 - age*26.0) * exp(-age*3.0) * exp(-d*10.0);
    }
    warp += ripple * 0.012 * uRippleK;

    float a = gA(uv + warp);

    // 左→右の書き進み。先端に明るい水線。
    float wipe = smoothstep(uFill, uFill - 0.06, uv.x);
    float front = exp(-pow((uv.x - uFill) / 0.022, 2.0)) * step(0.5, gA(vec2(clamp(uFill,0.0,1.0), uv.y)) + a);
    a *= wipe;
    if (a < 0.02 && front < 0.02) discard;

    // 縁（メニスカス）
    float inA = gA(uv + warp + vec2(0.012, 0.0)) * gA(uv + warp - vec2(0.012, 0.0));
    float rim = clamp((a - inA) * 5.0, 0.0, 1.0);
    rim += smoothstep(0.55, 0.12, a) * step(0.06, a) * 0.7;
    rim *= uRimK;

    // 内側で動くコースティック
    float caus = (0.5 + 0.5*sin(uv.x*9.0 + t*1.5 + sin(uv.y*7.0 - t)))
               * (0.5 + 0.5*sin(uv.y*11.0 - t*1.2));

    vec3 col = mix(uDeep, uBright, clamp(caus*0.6*uCaustic + ripple*2.2*uRippleK, 0.0, 1.0));
    col += rim * uRim;
    col += front * uRim * 1.6;

    float alpha = (a * (0.55 + 0.45*rim) + front*0.55) * uOpacity;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

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
    this._built = false;
    this._vis = 0;

    // ワールド空間（部屋）
    this.world = new THREE.Group();
    this.scene.add(this.world);

    // 宙の雨＋フィーダー粒
    const n = CFG.COUNT;
    const geo = new THREE.CylinderGeometry(0.0042, 0.0042, 1, 5, 1, true);
    const dmat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false
    });
    this._mesh = new THREE.InstancedMesh(geo, dmat, n);
    this._mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this._mesh.frustumCulled = false;
    this._mesh.renderOrder = 2;
    this.world.add(this._mesh);

    this._nFeed = Math.floor(n * CFG.FEED_FRAC);
    this._d = new Array(n);
    for (let i = 0; i < n; i++) {
      this._d[i] = {
        role: i < this._nFeed ? "feed" : "room",
        home: new THREE.Vector3(),
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        frozen: new THREE.Vector3(),
        tgt: new THREE.Vector3(),
        tgtU: 0,
        surf: "t",
        len: 0.012,
        bright: 0,
        absorbed: false,
        phase: Math.random() * 100,
        stagger: Math.random(),
        fallFrom: 1.5 + Math.random() * 3
      };
    }

    // 液体の水膜（本物のグリフ形＋液体シェーダ）
    this._title = this._makeSurface(CFG.TITLE, 132, CFG.TITLE_W, CFG.TITLE_H, CFG.TITLE_Y);
    this._sub = this._makeSurface(CFG.SUBTITLE, 60, CFG.SUB_W, CFG.SUB_H, CFG.TITLE_Y + CFG.SUB_Y);
    this.world.add(this._title.mesh, this._sub.mesh);

    // しずく
    this._drips = [];
    if (CFG.DRIPS > 0) {
      const dgeo = new THREE.SphereGeometry(0.012, 8, 6);
      const dmat2 = new THREE.MeshBasicMaterial({
        color: CFG.BRIGHT, transparent: true, opacity: 0, depthWrite: false, toneMapped: false
      });
      this._dripMesh = new THREE.InstancedMesh(dgeo, dmat2, CFG.DRIPS);
      this._dripMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this._dripMesh.frustumCulled = false;
      this._dripMesh.renderOrder = 3;
      this.world.add(this._dripMesh);
      for (let i = 0; i < CFG.DRIPS; i++) {
        this._drips.push({
          anchor: new THREE.Vector3(),
          t: Math.random() * 3,
          period: CFG.DRIP_PERIOD[0] + Math.random() * (CFG.DRIP_PERIOD[1] - CFG.DRIP_PERIOD[0])
        });
      }
    }

    // 波紋
    this._ring = null;
    if (CFG.SHOCKWAVE) {
      this._ring = new THREE.Mesh(
        new THREE.RingGeometry(0.86, 0.94, 64),
        new THREE.MeshBasicMaterial({
          color: CFG.RAIN_COLOR, transparent: true, opacity: 0, depthWrite: false,
          side: THREE.DoubleSide, toneMapped: false
        })
      );
      this._ring.rotation.x = -Math.PI / 2;
      this._ring.renderOrder = 2;
      this.world.add(this._ring);
    }

    // カメラ子: 開始プロンプトの目隠し・「手を動かして」
    this.hud = new THREE.Group();
    this.camera.add(this.hud);
    this._veil = null;
    if (CFG.PROMPT_VEIL) {
      this._veil = new THREE.Mesh(
        new THREE.PlaneGeometry(1.3, 0.72),
        new THREE.MeshBasicMaterial({
          color: CFG.VEIL_COLOR, transparent: true, opacity: 0, depthWrite: false,
          depthTest: false, toneMapped: false
        })
      );
      this._veil.position.set(0, -0.02, -1.36);
      this._veil.renderOrder = 10050;
      this.hud.add(this._veil);
    }
    this._paintPanel = this._makePaintPrompt();
    if (this._paintPanel) this.hud.add(this._paintPanel.mesh);

    // アンカー
    this._anchor = new THREE.Vector3();
    this._anchorYaw = new THREE.Quaternion();

    // スクラッチ
    this._dummy = new THREE.Object3D();
    this._c = new THREE.Color();
    this._cRain = new THREE.Color(CFG.RAIN_COLOR);
    this._cWake = new THREE.Color(CFG.WAKE_COLOR);
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._hands = [new THREE.Vector3(), new THREE.Vector3()];
    this._handCount = 0;
    this._impactHead = { t: 0, s: 0 };
  }

  _makeSurface(text, fontPx, worldW, worldH, yOffset) {
    // グリフをキャンバスに（細い画は stroke で太らせる）
    const W = 1024;
    const H = Math.max(160, Math.round((worldH / worldW) * W));
    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const g = cv.getContext("2d");
    g.clearRect(0, 0, W, H);
    g.fillStyle = "#fff";
    g.strokeStyle = "#fff";
    g.lineJoin = "round";
    g.lineWidth = fontPx * 0.16;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `800 ${fontPx}px system-ui, sans-serif`;
    g.strokeText(text, W / 2, H / 2);
    g.fillText(text, W / 2, H / 2);

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;

    // 湾曲したプレーン（両端が少しこちらへ）
    const seg = 40;
    const pg = new THREE.PlaneGeometry(worldW, worldH, seg, 6);
    const R = CFG.DIST;
    const p = pg.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x0 = p.getX(i);
      const phi = ((x0 / R) * CFG.WRAP_GAIN);
      p.setX(i, R * Math.sin(phi));
      p.setZ(i, -R * Math.cos(phi) + R);
    }
    p.needsUpdate = true;
    pg.computeVertexNormals();

    const mat = new THREE.ShaderMaterial({
      vertexShader: LIQUID_VERT,
      fragmentShader: LIQUID_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uGlyph: { value: tex },
        uTime: { value: 0 },
        uFill: { value: 0 },
        uOpacity: { value: 0 },
        uWobble: { value: CFG.LIQ_WOBBLE },
        uRimK: { value: CFG.LIQ_RIM },
        uCaustic: { value: CFG.LIQ_CAUSTIC },
        uRippleK: { value: CFG.RIPPLE_STRENGTH },
        uDeep: { value: new THREE.Color(CFG.DEEP) },
        uBright: { value: new THREE.Color(CFG.BRIGHT) },
        uRim: { value: new THREE.Color(CFG.RIM) },
        uImpacts: { value: Array.from({ length: N_IMPACT }, () => new THREE.Vector3(0, 0, -1)) }
      }
    });
    const mesh = new THREE.Mesh(pg, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;

    // グリフのアルファからサンプル点（フィーダー目標）と下端点（しずく）を作る
    const data = g.getImageData(0, 0, W, H).data;
    const pts = [];
    let minX = W, maxX = 0, minY = H, maxY = 0;
    const colBottom = new Float32Array(W).fill(-1);
    for (let y = 0; y < H; y += 3) {
      for (let x = 0; x < W; x += 3) {
        if (data[(y * W + x) * 4 + 3] > 120) {
          pts.push(x, y);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (y > colBottom[x]) colBottom[x] = y;
        }
      }
    }
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    // シャッフル
    const m = pts.length / 2;
    for (let i = m - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      for (let k = 0; k < 2; k++) {
        const a = i * 2 + k, b = j * 2 + k;
        const tmp = pts[a]; pts[a] = pts[b]; pts[b] = tmp;
      }
    }

    return {
      mesh,
      mat,
      tex,
      cv,
      W, H, minX, minY, bw, bh,
      worldW, worldH, yOffset,
      hits: pts,
      colBottom,
      impacts: mat.uniforms.uImpacts.value,
      impactHead: 0,
      fillTarget: 0,
      fillNow: 0
    };
  }

  _makePaintPrompt() {
    const cv = document.createElement("canvas");
    cv.width = 420;
    cv.height = 132;
    const g = cv.getContext("2d");
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#cfe0ff";
    g.font = "600 56px system-ui, sans-serif";
    g.fillText("手を動かして", 210, 66);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.16),
      new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0, depthWrite: false, depthTest: false, toneMapped: false
      })
    );
    mesh.position.set(0, -0.32, -0.95);
    mesh.renderOrder = 10051;
    return { mesh, tex };
  }

  /** アンカー基準ローカル(x,y は目線相対 / z は前方が負) → ワールド */
  _l2w(lx, ly, lz, out) {
    return out.set(lx, ly, lz).applyQuaternion(this._anchorYaw).add(this._anchor);
  }

  /** 水膜サーフェスの (col,row) → 湾曲面上のワールド座標。u01 も返す（out に書く, 戻り値=u01） */
  _surfPointWorld(surf, col, row, out) {
    const u01 = (col - surf.minX) / surf.bw; // 0..1
    const v01 = (row - surf.minY) / surf.bh;
    const R = CFG.DIST;
    const phi = (((u01 - 0.5) * surf.worldW) / R) * CFG.WRAP_GAIN;
    const lx = R * Math.sin(phi);
    const ly = (0.5 - v01) * surf.worldH + surf.yOffset;
    const lz = -R * Math.cos(phi);
    this._l2w(lx, ly, lz, out);
    return u01;
  }

  _build() {
    this.camera.updateWorldMatrix(true, false);
    this.camera.getWorldPosition(this._anchor);
    this.camera.getWorldQuaternion(this._q);
    this._v.copy(FWD).applyQuaternion(this._q);
    const yaw = Math.atan2(this._v.x, -this._v.z);
    this._anchorYaw.setFromAxisAngle(UP, yaw);

    // 水膜メッシュをアンカーに置く（中心が正面 -DIST）
    for (const s of [this._title, this._sub]) {
      this._l2w(0, s.yOffset, -CFG.DIST, this._v);
      s.mesh.position.copy(this._v);
      s.mesh.quaternion.copy(this._anchorYaw);
      s.mat.uniforms.uFill.value = 0;
      s.mat.uniforms.uOpacity.value = 0;
      s.fillNow = 0;
      s.fillTarget = 0;
      s.impactHead = 0;
      for (const im of s.impacts) im.set(0, 0, -1);
    }

    // 粒のホーム＆フィーダー目標
    const R = CFG.ROOM;
    for (let i = 0; i < this._d.length; i++) {
      const d = this._d[i];
      const lx = (Math.random() * 2 - 1) * R.x;
      const lz = -(Math.random() * (R.zFront + R.zBack)) + R.zBack;
      const ly = R.yBot + Math.random() * (R.yTop - R.yBot);
      this._l2w(lx, ly, lz, d.home);
      d.pos.copy(d.home);
      d.pos.y += d.fallFrom;
      d.vel.set(0, 0, 0);
      d.bright = 0;
      d.len = 0.012;
      d.absorbed = false;
      d.frozen.copy(d.pos);

      if (d.role === "feed") {
        const surf = Math.random() < CFG.FEED_TITLE_BIAS ? this._title : this._sub;
        d.surf = surf === this._title ? "t" : "s";
        const hi = ((Math.random() * (surf.hits.length / 2)) | 0) * 2;
        d.tgtU = this._surfPointWorld(surf, surf.hits[hi], surf.hits[hi + 1], d.tgt);
        d.tgtRow = surf.hits[hi + 1];
        d.tgtCol = surf.hits[hi];
        d.stagger = d.tgtU; // 左→右で流れ込む
      }
    }

    // しずくの初期アンカー（下端）
    if (this._drips.length) {
      for (let k = 0; k < this._drips.length; k++) {
        const surf = k < this._drips.length * 0.72 ? this._title : this._sub;
        this._reanchorDrip(this._drips[k], surf);
        this._drips[k].t = Math.random() * this._drips[k].period;
      }
    }

    if (this._ring) this._ring.position.set(this._anchor.x, this._anchor.y - 1.5, this._anchor.z);
    this._phase = "SUSPEND";
    this._phaseT = 0;
    if (this._veil) this._veil.material.opacity = 0;
    if (this._paintPanel) this._paintPanel.mesh.material.opacity = 0;
    if (this._ring) this._ring.material.opacity = 0;
    this._mesh.material.opacity = 0.9;
    this._built = true;
    if (REDUCED_MOTION) this._snapToHold();
  }

  _reanchorDrip(drip, surf) {
    // グリフ下端の列からランダムに1点
    let tries = 0;
    let col = 0;
    do {
      col = (surf.minX + Math.random() * surf.bw) | 0;
      tries++;
    } while (surf.colBottom[col] < 0 && tries < 20);
    const row = surf.colBottom[col] < 0 ? surf.minY + surf.bh : surf.colBottom[col];
    this._surfPointWorld(surf, col, row, drip.anchor);
    drip.surf = surf;
  }

  _snapToHold() {
    this._phase = "HOLD";
    this._phaseT = 0;
    for (const s of [this._title, this._sub]) {
      s.mat.uniforms.uFill.value = 1;
      s.fillNow = 1;
      s.fillTarget = 1;
      s.mat.uniforms.uOpacity.value = 1;
    }
    for (const d of this._d) {
      if (d.role === "feed") {
        d.absorbed = true;
        d.len = 0;
      } else {
        d.pos.copy(d.home);
        d.bright = 0.12;
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
      this._l2w(
        0.75 * Math.sin(this._t * 1.3),
        0.35 + 0.7 * Math.sin(this._t * 1.9),
        -1.1 + 0.55 * Math.cos(this._t * 0.9),
        this._hands[0]
      );
      this._handCount = 1;
    }
  }

  _pushImpact(surf, u, v, tNow) {
    const im = surf.impacts[surf.impactHead % N_IMPACT];
    im.set(u, v, tNow);
    surf.impactHead++;
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
      this.hud.visible = false;
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
    this._updateSurfaces(dt);
    this._updateDrips(dt);
    this._render();
  }

  _advance(dt) {
    const P = this._phase;
    const sm = (p) => (p <= 0 ? 0 : p >= 1 ? 1 : p * p * (3 - 2 * p));

    if (P === "SUSPEND") {
      for (const d of this._d) {
        const p = sm((this._phaseT - d.stagger * (CFG.SUSPEND_SEC * 0.6)) / (CFG.SUSPEND_SEC * 0.4));
        d.pos.set(d.home.x, d.home.y + d.fallFrom * (1 - p), d.home.z);
        d.len = 0.05 + (0.012 - 0.05) * p;
        d.bright = 0.1 + 0.15 * p;
        this._shiver(d, p);
      }
      if (this._paintPanel) {
        this._paintPanel.mesh.material.opacity =
          sm((this._phaseT - CFG.SUSPEND_SEC * 0.6) / (CFG.SUSPEND_SEC * 0.4)) * 0.9;
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
        for (const d of this._d) d.frozen.copy(d.pos);
        this._paintFade = this._paintPanel ? this._paintPanel.mesh.material.opacity : 0;
        this._phase = "CONDENSE";
        this._phaseT = 0;
      }
    } else if (P === "CONDENSE") {
      let feedersDone = true;
      for (const d of this._d) {
        if (d.role === "room") {
          this._shiver(d, 1);
          d.bright = Math.max(0.12, d.bright - dt * 0.3);
          continue;
        }
        if (d.absorbed) {
          d.len = 0;
          continue;
        }
        const raw = (this._phaseT - d.stagger * (CFG.CONDENSE_SEC * 0.8)) / (CFG.CONDENSE_SEC * 0.35);
        const k = raw <= 0 ? 0 : raw >= 1 ? 1 : raw;
        if (k < 1) feedersDone = false;
        const e = easeIn(k);
        d.pos.set(
          d.frozen.x + (d.tgt.x - d.frozen.x) * e,
          d.frozen.y + (d.tgt.y - d.frozen.y) * e,
          d.frozen.z + (d.tgt.z - d.frozen.z) * e
        );
        d.len = 0.05 + (0.02 - 0.05) * k;
        d.bright = 0.5 + 0.9 * k;
        if (k >= 1) {
          d.absorbed = true;
          d.len = 0;
          const surf = d.surf === "t" ? this._title : this._sub;
          const v01 = (d.tgtRow - surf.minY) / surf.bh;
          this._pushImpact(surf, d.tgtU, v01, this._t);
          surf.fillTarget = Math.max(surf.fillTarget, d.tgtU);
        }
      }
      // 時間床（フィーダーが遅れても満ちきる）
      const floor = Math.min(1, this._phaseT / CFG.CONDENSE_SEC);
      this._title.fillTarget = Math.min(1, Math.max(this._title.fillTarget, floor));
      this._sub.fillTarget = Math.min(1, Math.max(this._sub.fillTarget, floor));
      for (const s of [this._title, this._sub]) s.mat.uniforms.uOpacity.value = this._vis;
      if (this._paintPanel) {
        this._paintPanel.mesh.material.opacity = (this._paintFade ?? 0.9) * (1 - sm(this._phaseT / 0.5));
      }
      if (this._veil) {
        this._veil.material.opacity = 0.5 * (1 - sm(this._phaseT / (CFG.CONDENSE_SEC * 0.6))) * this._vis;
      }
      if (feedersDone && this._title.fillNow > 0.98 && this._sub.fillNow > 0.98) {
        this._phase = "HEARTBEAT";
        this._phaseT = 0;
        if (this._ring) {
          this._ring.material.opacity = 0.55;
          this._ring.scale.setScalar(0.2);
        }
        for (const d of this._d) if (d.role === "room") d.vel.set(0, -CFG.REAL_SPEED, 0);
      }
    } else if (P === "HEARTBEAT") {
      for (const d of this._d) {
        if (d.role !== "room") continue;
        d.pos.addScaledVector(d.vel, dt);
        d.len = 0.42;
        d.bright = 0.7;
        if (d.pos.y < this._anchor.y + CFG.ROOM.yBot) {
          d.pos.y = this._anchor.y + CFG.ROOM.yTop;
          d.home.copy(d.pos);
        }
      }
      if (this._ring) {
        const p = Math.min(1, this._phaseT / (CFG.HEARTBEAT_SEC + 0.5));
        this._ring.scale.setScalar(0.2 + p * 4.2);
        this._ring.material.opacity = 0.55 * (1 - p) * this._vis;
      }
      for (const s of [this._title, this._sub]) s.mat.uniforms.uOpacity.value = this._vis;
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
      for (const s of [this._title, this._sub]) {
        s.fillTarget = 1;
        s.mat.uniforms.uOpacity.value = this._vis;
      }
      for (const d of this._d) {
        if (d.role === "room") {
          this._shiver(d, 1);
          d.bright = 0.12 + 0.03 * Math.sin(this._t * 0.7 + d.phase);
        } else {
          d.len = 0;
        }
      }
    } else if (P === "RELEASE") {
      for (const d of this._d) {
        if (d.absorbed) {
          // 水膜からほどけて落ちる
          d.absorbed = false;
          d.pos.copy(d.tgt);
        }
        if (d.vel.lengthSq() === 0) {
          d.vel.set((Math.random() * 2 - 1) * 0.4, -1.1 - Math.random() * 1.4, (Math.random() * 2 - 1) * 0.3);
        }
        d.pos.addScaledVector(d.vel, dt);
        d.len = Math.min(0.3, Math.max(d.len, 0.02) + dt * 0.8);
        d.bright = Math.max(0, d.bright - dt / CFG.RELEASE_SEC);
      }
      const p = Math.min(1, this._phaseT / CFG.RELEASE_SEC);
      this._mesh.material.opacity = 0.9 * (1 - p);
      for (const s of [this._title, this._sub]) {
        s.fillTarget = 1 - p; // 右→左に引く
        s.mat.uniforms.uOpacity.value = (1 - p) * this._vis;
      }
      this._vis = 1 - p;
      if (p >= 1) {
        this._built = false;
        this._mesh.material.opacity = 0.9;
        for (const d of this._d) d.vel.set(0, 0, 0);
      }
    }
  }

  _updateSurfaces(dt) {
    for (const s of [this._title, this._sub]) {
      s.fillNow = THREE.MathUtils.damp(s.fillNow, s.fillTarget, 6, dt);
      s.mat.uniforms.uFill.value = s.fillNow;
      s.mat.uniforms.uTime.value = this._t;
    }
  }

  _updateDrips(dt) {
    if (!this._drips.length) return;
    const dm = this._dummy;
    dm.quaternion.identity();
    const active = this._phase === "HOLD" || this._phase === "CONDENSE";
    let anyVisible = false;
    for (let i = 0; i < this._drips.length; i++) {
      const dr = this._drips[i];
      dr.t += dt;
      if (dr.t > dr.period) {
        dr.t = 0;
        dr.period = CFG.DRIP_PERIOD[0] + Math.random() * (CFG.DRIP_PERIOD[1] - CFG.DRIP_PERIOD[0]);
        this._reanchorDrip(dr, dr.surf || this._title);
      }
      // 0..1: たまって → 伸びて → 落ちて → 消える
      const p = dr.t / dr.period;
      let yoff = 0;
      let scale = 0;
      let op = 0;
      if (active && p > 0.35) {
        const q = (p - 0.35) / 0.65; // 0..1
        yoff = -CFG.DRIP_FALL * (q * q);
        scale = 1;
        op = q < 0.15 ? q / 0.15 : 1 - (q - 0.15) / 0.85;
      }
      dm.position.copy(dr.anchor);
      dm.position.y += yoff;
      dm.scale.set(scale, scale * (1 + Math.min(2, -yoff * 12)), scale);
      dm.updateMatrix();
      this._dripMesh.setMatrixAt(i, dm.matrix);
      if (op > 0.01) anyVisible = true;
      dr._op = op;
    }
    // まとめて不透明度（インスタンスごとの色は使わずマテリアル単一）
    let avg = 0;
    for (const dr of this._drips) avg += dr._op || 0;
    this._dripMesh.material.opacity = active ? (avg / this._drips.length) * 0.9 * this._vis : 0;
    this._dripMesh.instanceMatrix.needsUpdate = true;
    this._dripMesh.visible = anyVisible && active;
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
        dm.position.set(0, -9999, 0);
        dm.scale.set(0, 0, 0);
      } else {
        dm.position.copy(d.pos);
        dm.scale.set(1, d.len, 1);
      }
      dm.updateMatrix();
      this._mesh.setMatrixAt(i, dm.matrix);
      const b = d.bright;
      if (b > 1) this._c.copy(this._cWake);
      else this._c.copy(this._cRain).lerp(this._cWake, Math.max(0, b));
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
    for (const s of [this._title, this._sub]) {
      s.mesh.geometry.dispose();
      s.mat.dispose();
      s.tex.dispose();
    }
    if (this._dripMesh) {
      this._dripMesh.geometry.dispose();
      this._dripMesh.material.dispose();
    }
    if (this._ring) {
      this._ring.geometry.dispose();
      this._ring.material.dispose();
    }
    if (this._veil) {
      this._veil.geometry.dispose();
      this._veil.material.dispose();
    }
    if (this._paintPanel) {
      this._paintPanel.mesh.geometry.dispose();
      this._paintPanel.mesh.material.dispose();
      this._paintPanel.tex.dispose();
    }
  }
}

function easeIn(x) {
  return x <= 0 ? 0 : x >= 1 ? 1 : x * x * x;
}
