import * as THREE from "three";
import { GAME_DURATION, PLAYER_LIVES } from "../utils/constants.js";

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
 *   HOLD      水膜が息づき、下に「▶ トリガーで開始」の看板が出る（明滅）。ゲームのタイトル画面
 *   RELEASE   トリガーで START を抜けると確定フラッシュ→水膜が崩れ、粒が雨に戻って落ちて消える
 *
 * prefers-reduced-motion のときは即 HOLD（完成形を静止表示）。
 */

const CFG = {
  TITLE: "雨避け",
  SUBTITLE: "よけていた、つもりだった。",

  DEEP: 0x2c6aa8, // 液体の地の色（読みやすい中間の青）
  BRIGHT: 0xdcefff, // 上縁のハイライト
  RIM: 0xffffff, // 波紋・書き先端
  SHADOW: 0x05101c, // 文字の後ろの暗い縁（明るい部屋でも読めるように）
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
  SUB_Y: -0.4, // 副題中心（タイトル中心からの相対, m）
  SUB_W: 1.44,
  SUB_H: 0.18,
  WRAP_GAIN: 1.0, // 面の湾曲（1で自然、0で平面）

  // 液体シェーダの効き（読みやすさ優先で控えめが既定。上げると“濡れ”が強くなる）
  LIQ_WOBBLE: 0.6, // 面のうねり（形は保つ）
  LIQ_RIM: 0.8, // 上縁の光
  LIQ_CAUSTIC: 0.4, // 内側の弱いムラ
  RIPPLE_STRENGTH: 0.6, // 着弾波紋
  STROKE_K: 0.03, // グリフを太らせる量（fontPx比）。0で素の字。細ひらがな対策で少しだけ
  TEXT_SHADOW: true, // 文字の後ろに暗いコピーを敷いて可読性を上げる
  BODY_ALPHA: 0.82, // 液体の地の不透明度（下げると透ける）

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
  // 以前は StartScreen の視界追従パネルを隠すためのぼけた暗がりだったが、
  // StartScreen は START 中は非表示になったので不要（出しっぱなしだと目の前に
  // 謎の暗がりが浮くだけになる）。
  PROMPT_VEIL: false,
  VEIL_COLOR: 0x0a0e16,
  VEIL_OPACITY: 0.7,

  // ゲームスタート画面としての体裁（HOLD で出る「トリガーで開始」の看板）
  // モード表示・トリガー案内も含めて全部ここ（ワールド固定）にまとめる。
  // StartScreen の視界追従パネルとは表示タイミングが違って読みにくかったため統合した。
  START_PROMPT: true,
  PROMPT_LABEL: "トリガーで開始",
  PROMPT_W: 1.02,
  PROMPT_H: 0.46,
  PROMPT_GAP: 0.16, // 副題の下端からの間隔(m)
  PROMPT_PULSE_HZ: 0.9 // 明滅の速さ
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
  uniform float uTime, uFill, uOpacity, uWobble, uRimK, uCaustic, uRippleK, uBodyA;
  uniform vec3 uDeep, uBright, uRim;
  uniform vec3 uImpacts[${N_IMPACT}];

  float gA(vec2 uv){
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    return texture2D(uGlyph, uv).a;
  }
  void main(){
    vec2 uv = vUv;
    float t = uTime;

    // ごく弱いうねり（字の形は保つ）
    vec2 warp = vec2(
      sin(uv.y*18.0 + t*1.4) + 0.5*sin(uv.x*11.0 - t*0.9),
      sin(uv.x*15.0 - t*1.1) + 0.5*sin(uv.y*13.0 + t*0.7)
    ) * 0.0016 * uWobble;

    // 着弾波紋（弱め）
    float ripple = 0.0;
    for (int i = 0; i < ${N_IMPACT}; i++) {
      vec3 im = uImpacts[i];
      if (im.z < 0.0) continue;
      float age = t - im.z;
      if (age < 0.0 || age > 1.4) continue;
      float d = distance(uv, im.xy);
      ripple += sin(d*70.0 - age*22.0) * exp(-age*3.5) * exp(-d*12.0);
    }
    vec2 wuv = uv + warp + vec2(0.0, ripple * 0.004 * uRippleK);

    float a = gA(wuv);
    float wipe = smoothstep(uFill + 0.02, uFill - 0.05, uv.x);
    a *= wipe;

    // 上下の縁（上＝光、下＝陰）だけを細く
    float up = gA(wuv + vec2(0.0, 0.009));
    float dn = gA(wuv - vec2(0.0, 0.009));
    float inGlyph = step(0.25, a);
    float topRim = clamp((dn - up) * 2.4, 0.0, 1.0) * inGlyph;
    float botRim = clamp((up - dn) * 2.4, 0.0, 1.0) * inGlyph;

    // 弱いコースティック
    float caus = sin(uv.x*7.0 + t*1.1 + sin(uv.y*5.0 - t*0.6));

    vec3 col = mix(uDeep, uDeep * 1.28, uv.y);        // 上ほど少し明るい
    col += caus * 0.05 * uCaustic;
    col += topRim * uBright * (0.85 * uRimK);
    col = max(col - botRim * 0.22, 0.0);
    col += ripple * 0.10 * uRippleK;

    // 書き先端の細い水線
    float front = exp(-pow((uv.x - uFill) / 0.016, 2.0))
                * step(0.08, gA(vec2(clamp(uFill, 0.001, 0.999), uv.y)));
    col += front * uBright * 0.7;

    float alpha = (a * uBodyA + front * 0.45) * uOpacity;
    if (alpha < 0.02) discard;
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

    // タイトル = 液体マシマシ。副題 = 小さい細ひらがなが潰れないよう“ほぼ素の水”で（読み優先）。
    this._title = this._makeSurface(CFG.TITLE, 132, CFG.TITLE_W, CFG.TITLE_H, CFG.TITLE_Y, {});
    this._sub = this._makeSurface(CFG.SUBTITLE, 66, CFG.SUB_W, CFG.SUB_H, CFG.TITLE_Y + CFG.SUB_Y, {
      wobble: 0.14,
      rim: 0.35,
      caustic: 0.08,
      bodyA: 0.95,
      strokeK: 0.085,
      shadowScale: [1.03, 1.14, 1.03]
    });
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
    // 目隠し = 素の StartScreen パネルだけを隠す、ふちがぼけた暗がり（板に見えないように）
    this._veil = null;
    if (CFG.PROMPT_VEIL) {
      const vc = document.createElement("canvas");
      vc.width = vc.height = 256;
      const vg = vc.getContext("2d");
      const grad = vg.createRadialGradient(128, 128, 10, 128, 128, 128);
      const cc = new THREE.Color(CFG.VEIL_COLOR);
      const rgb = `${(cc.r * 255) | 0},${(cc.g * 255) | 0},${(cc.b * 255) | 0}`;
      grad.addColorStop(0, `rgba(${rgb},0.92)`);
      grad.addColorStop(0.6, `rgba(${rgb},0.55)`);
      grad.addColorStop(1, `rgba(${rgb},0)`);
      vg.fillStyle = grad;
      vg.fillRect(0, 0, 256, 256);
      const vtex = new THREE.CanvasTexture(vc);
      vtex.colorSpace = THREE.SRGBColorSpace;
      this._veil = new THREE.Mesh(
        new THREE.PlaneGeometry(1.15, 0.62),
        new THREE.MeshBasicMaterial({
          map: vtex, transparent: true, opacity: 0, depthWrite: false, depthTest: false, toneMapped: false
        })
      );
      this._veil.position.set(0, -0.02, -1.38);
      this._veil.renderOrder = 10050;
      this._veilTex = vtex;
      this.hud.add(this._veil);
    }
    this._paintPanel = this._makePaintPrompt();
    if (this._paintPanel) this.hud.add(this._paintPanel.mesh);

    this._startPrompt = CFG.START_PROMPT ? this._makeStartPrompt() : null;
    if (this._startPrompt) {
      this.world.add(this._startPrompt.mesh);
      this._lastSwat = !!ctx.swatMode;
      this._drawStartPrompt(this._lastSwat);
    }

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

  _makeSurface(text, fontPx, worldW, worldH, yOffset, opts = {}) {
    const strokeK = opts.strokeK ?? CFG.STROKE_K;
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
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `800 ${fontPx}px system-ui, sans-serif`;
    if (strokeK > 0) {
      g.lineWidth = fontPx * strokeK;
      g.strokeText(text, W / 2, H / 2);
    }
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
        uWobble: { value: opts.wobble ?? CFG.LIQ_WOBBLE },
        uRimK: { value: opts.rim ?? CFG.LIQ_RIM },
        uCaustic: { value: opts.caustic ?? CFG.LIQ_CAUSTIC },
        uRippleK: { value: opts.ripple ?? CFG.RIPPLE_STRENGTH },
        uBodyA: { value: opts.bodyA ?? CFG.BODY_ALPHA },
        uDeep: { value: new THREE.Color(CFG.DEEP) },
        uBright: { value: new THREE.Color(CFG.BRIGHT) },
        uRim: { value: new THREE.Color(CFG.RIM) },
        uImpacts: { value: Array.from({ length: N_IMPACT }, () => new THREE.Vector3(0, 0, -1)) }
      }
    });
    const mesh = new THREE.Mesh(pg, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;

    // 文字の後ろの暗いコピー（明るい部屋でも輪郭が読めるように）
    let shadow = null;
    if (CFG.TEXT_SHADOW) {
      shadow = new THREE.Mesh(
        pg,
        new THREE.MeshBasicMaterial({
          map: tex,
          color: new THREE.Color(CFG.SHADOW),
          transparent: true,
          opacity: 0,
          depthWrite: false,
          depthTest: false,
          toneMapped: false
        })
      );
      const ss = opts.shadowScale ?? [1.045, 1.09, 1.045];
      shadow.scale.set(ss[0], ss[1], ss[2]);
      shadow.frustumCulled = false;
      shadow.renderOrder = 2.6; // 液体(3)より先＝後ろ
      mesh.add(shadow);
    }

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
      shadow,
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

  /** ゲームスタート画面の「トリガーで開始」看板（ワールド固定・タイトルの下）*/
  _makeStartPrompt() {
    const W = 960;
    const H = Math.round((CFG.PROMPT_H / CFG.PROMPT_W) * W);
    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const g = cv.getContext("2d");

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(CFG.PROMPT_W, CFG.PROMPT_H),
      new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0, depthWrite: false, depthTest: false, toneMapped: false
      })
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = 12;
    return { mesh, tex, cv, g, base: 0 };
  }

  /** 看板の中身を描き直す（モード切替のたび呼ぶ）。よける/殴り飛ばす・トリガー案内・ライフを1枚に集約。 */
  _drawStartPrompt(swat) {
    const p = this._startPrompt;
    if (!p) return;
    const { cv, g } = p;
    const W = cv.width;
    const H = cv.height;
    g.clearRect(0, 0, W, H);
    // 角丸の半透明バー＋シアンの縁（StartScreen と同系統）
    const pad = 6;
    rrect(g, pad, pad, W - pad * 2, H - pad * 2, 22);
    g.fillStyle = "rgba(8,12,22,0.62)";
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = "rgba(124,196,255,0.6)";
    g.stroke();

    g.textAlign = "center";
    g.textBaseline = "middle";
    // ▶ トリガーで開始
    g.shadowColor = "#8fd0ff";
    g.shadowBlur = 22;
    g.fillStyle = "#eef4ff";
    g.font = `700 ${Math.round(H * 0.2)}px system-ui, sans-serif`;
    g.fillText("▶  " + CFG.PROMPT_LABEL, W / 2, H * 0.17);
    g.shadowBlur = 0;
    // モード
    g.fillStyle = swat ? "#7cf0c4" : "#7cc4ff";
    g.font = `600 ${Math.round(H * 0.125)}px system-ui, sans-serif`;
    g.fillText(`モード：${swat ? "殴り飛ばす" : "よける"}　—　${GAME_DURATION}秒`, W / 2, H * 0.4);
    // トリガー案内
    g.fillStyle = "#9fb4d6";
    g.font = `500 ${Math.round(H * 0.1)}px system-ui, sans-serif`;
    g.fillText("左トリガー：モード切替", W / 2, H * 0.58);
    // ライフ ♥×n
    g.fillStyle = "#ff8fa3";
    g.font = `600 ${Math.round(H * 0.125)}px system-ui, sans-serif`;
    g.fillText("♥".repeat(Math.max(1, PLAYER_LIVES | 0)), W / 2, H * 0.81);

    p.tex.needsUpdate = true;
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

    // スタート看板を副題の下に（同じロックアップとして並べる）
    if (this._startPrompt) {
      const py = CFG.TITLE_Y + CFG.SUB_Y - CFG.SUB_H * 0.5 - CFG.PROMPT_GAP - CFG.PROMPT_H * 0.5;
      this._l2w(0, py, -CFG.DIST, this._v);
      this._startPrompt.mesh.position.copy(this._v);
      this._startPrompt.mesh.quaternion.copy(this._anchorYaw);
      this._startPrompt.mesh.scale.setScalar(1);
      this._startPrompt.mesh.material.opacity = 0;
      this._startPrompt.base = 0;
    }
    this._flash = 0;

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
    if (this._veil) this._veil.material.opacity = CFG.VEIL_OPACITY;
    if (this._paintPanel) this._paintPanel.mesh.material.opacity = 0;
    if (this._startPrompt) {
      this._startPrompt.base = 1;
      this._startPrompt.mesh.material.opacity = 1;
    }
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
      this._flash = 1; // 開始の確定フラッシュ
    }
    this._wasStart = isStart;
    if (this._startPrompt) {
      const swat = !!ctx.swatMode;
      if (swat !== this._lastSwat) {
        this._lastSwat = swat;
        this._drawStartPrompt(swat);
      }
    }
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
    this._updatePrompt(dt);
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
      if (this._veil) this._veil.material.opacity = CFG.VEIL_OPACITY * this._vis;
      if (this._phaseT >= CFG.SUSPEND_SEC) {
        this._phase = "PAINT";
        this._phaseT = 0;
      }
    } else if (P === "PAINT") {
      this._paint(dt);
      for (const d of this._d) this._shiver(d, 1);
      if (this._veil) this._veil.material.opacity = CFG.VEIL_OPACITY * this._vis;
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
      if (this._veil) this._veil.material.opacity = CFG.VEIL_OPACITY * this._vis; // 開始プロンプトを隠したままに
      if (this._startPrompt) {
        this._startPrompt.base = sm((this._phaseT - CFG.CONDENSE_SEC * 0.55) / (CFG.CONDENSE_SEC * 0.45));
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
      if (this._veil) this._veil.material.opacity = CFG.VEIL_OPACITY * this._vis; // 素の StartScreen パネルを隠したまま
      if (this._ring) this._ring.material.opacity = 0;
      if (this._startPrompt) this._startPrompt.base = 1;
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
      if (this._startPrompt) this._startPrompt.base = 1 - p;
      if (this._veil) this._veil.material.opacity = CFG.VEIL_OPACITY * (1 - p) * this._vis;
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
      if (s.shadow) {
        const o = s.mat.uniforms.uOpacity.value;
        s.shadow.material.opacity = 0.5 * o * THREE.MathUtils.clamp((s.fillNow - 0.03) / 0.15, 0, 1);
      }
    }
  }

  _updatePrompt(dt) {
    if (!this._startPrompt) return;
    this._flash = Math.max(0, (this._flash || 0) - dt / 0.3);
    const sp = this._startPrompt;
    const w = Math.sin(this._t * Math.PI * 2 * CFG.PROMPT_PULSE_HZ);
    const targetOp = REDUCED_MOTION ? sp.base : sp.base * (0.82 + 0.18 * w);
    sp.mesh.material.opacity = THREE.MathUtils.damp(
      sp.mesh.material.opacity,
      Math.min(1.2, targetOp + this._flash),
      16,
      dt
    );
    const sc = (REDUCED_MOTION ? 1 : 1 + 0.015 * w) + this._flash * 0.1;
    sp.mesh.scale.setScalar(sc);
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
      if (s.shadow) s.shadow.material.dispose();
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
      this._veilTex?.dispose();
    }
    if (this._paintPanel) {
      this._paintPanel.mesh.geometry.dispose();
      this._paintPanel.mesh.material.dispose();
      this._paintPanel.tex.dispose();
    }
    if (this._startPrompt) {
      this._startPrompt.mesh.geometry.dispose();
      this._startPrompt.mesh.material.dispose();
      this._startPrompt.tex.dispose();
    }
  }
}

function easeIn(x) {
  return x <= 0 ? 0 : x >= 1 ? 1 : x * x * x;
}

/** 角丸矩形パス */
function rrect(c, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}
