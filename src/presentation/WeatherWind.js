import * as THREE from "three";
import { RAIN_TILT_ANGLE_DEG } from "../utils/constants.js";
import { createPanel, roundRect } from "./_panel.js";

/**
 * 「技術の無駄遣い」枠：本物の天気（風速・風向）を取ってきて、ゲーム内の斜め雨の
 * 向きと傾きに反映させる。on-theme（妄想の雨に現実の風を吹かせる）なのでやる。
 *
 * - データ元：Open-Meteo（APIキー不要・CORS開放・無料）
 * - 位置：?lat=&lon= のURL指定 → geolocation（4秒で打ち切り）→ FALLBACK（会場座標）
 * - デモ用の強制指定：?wind=12&dir=270 （風速 m/s ・ 風向 deg。会場が無風でも演出できる）
 *
 * ■ 北合わせ（現実のコンパス風向 → 部屋の向き）
 *   WebXR は方位磁石を持たないので、セッションの座標軸が真北から何度ズレているか
 *   分からない。合わせ方：
 *     1) ?north=NN … スタート時に頭が向いている方角（北=0・東=90・時計回り）を手動指定
 *     2) 端末のコンパスセンサー（deviceorientationabsolute）が拾えれば、START中に
 *        自動で1回だけ北合わせする（UIは出さない・完全に裏で行う）。
 *        ※ 以前は「矢印を真北に向けてグリップ」という手動キャリブUIだったが、
 *        そもそもユーザーが真北の方角を知らないと使えない上に、視界追従UIである
 *        必要（頭の向きに矢印を出し続ける仕組み）があり、他要素をワールド固定に
 *        揃えた結果ここだけ視界追従で浮いて見づらい、という2つの問題があったため撤去。
 *     3) 上記いずれも無ければ「開始時に北を向いていた」前提（従来のデフォルト）。
 *   ※ センサーが無い/信頼できない端末（PICOはマグネトメータを持たない可能性が高い）
 *   では 3) にフォールバックするだけで、体験としては壊れない（風向がずれるだけの演出差）。
 *
 * ■ ?wxdebug … 実機で風向の符号を検証するための表示。
 *     - カードに「期待:◯◯ / 計算:◯◯ / ✓一致 or ✗ズレ!」の自己チェック行を出す
 *       （?wind=6&dir=0/90/180/270 と回して、逆回転や反転なら ✗ が出る）
 *     - 世界に「雨はこっちへ流れるはず」の明るいマゼンタ矢印を出す
 *       （斜めモードの雨の傾きと見比べて、逆なら即わかる）
 *
 * core への足あとは RainPhysics.setWindSource(this._wind) の1呼び出しのみ。
 * ※ presentation → core はライフサイクル/セッター呼び出しのみ（DEVPLAN 接続ルール）。
 */

const FALLBACK = { lat: 33.79434, lon: 130.63585, label: "会場" };
const START_FACING_BEARING_DEG = 0;
const MAX_TILT_DEG = 45;
const REFRESH_MS = 5 * 60 * 1000;
const GEO_TIMEOUT_MS = 4000;
const DEG2RAD = Math.PI / 180;

const DIR8 = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];

/** 度（0=北・時計回り）→ 8方位ラベル＋度数。 */
function bearingLabel(deg) {
  const d = ((deg % 360) + 360) % 360;
  return `${DIR8[Math.round(d / 45) % 8]}(${Math.round(d)}°)`;
}

/** 気象の「風向」（風が吹いてくる方角）→ 8方位の日本語。 */
function compass8(fromDeg) {
  return DIR8[Math.round((((fromDeg % 360) + 360) % 360) / 45) % 8];
}

/**
 * 現実のコンパス風向 → ゲーム内の水平ドリフト方向（RainPhysics が使う「数学角」。
 * RainPhysics 側は windX = cos(azimuthRad) * hs, windZ = sin(azimuthRad) * hs で使う）。
 *
 * - fromDeg     : 気象の「風向」= 風が吹いてくる方角。雨が流される向きは +180。
 * - northYawRad : 「真北」に対応する部屋のワールドyaw（yaw 0 = -Z, +90° = +X, 時計回り）。
 *   ?north=F 指定なら northYawRad = -F*DEG2RAD、キャリブなら頭を北に向けた瞬間の yaw。
 *
 * driftYaw（風が流れていく向きのワールドyaw）= northYawRad + (fromDeg + 180)。
 * ワールド：yaw θ → 向き (sinθ, 0, -cosθ) なので worldX=sin, worldZ=-cos。
 */
function windAzimuthRad(fromDeg, northYawRad) {
  const driftYaw = northYawRad + (fromDeg + 180) * DEG2RAD;
  return Math.atan2(-Math.cos(driftYaw), Math.sin(driftYaw));
}

/** azimuthRad（数学角）→ ワールドyaw（0=北=-Z, +90°=東=+X, 時計回り）度。 */
function azimuthToWorldBearingDeg(azimuthRad) {
  const wx = Math.cos(azimuthRad);
  const wz = Math.sin(azimuthRad);
  return ((Math.atan2(wx, -wz) * 180) / Math.PI + 360) % 360;
}

/** 実風速(m/s) → 斜めの傾き角。無風で約6°、約6m/sで既定の30°、上限 MAX_TILT_DEG。 */
function speedToTiltRad(ms) {
  const deg = Math.max(6, Math.min(MAX_TILT_DEG, 6 + ms * 4));
  return deg * DEG2RAD;
}

export class WeatherWind {
  constructor(scene, ctx) {
    this.scene = scene;
    this.camera = ctx.camera;
    this.game = ctx.game;
    // TitleScreen が公開しているワールド固定アンカー（同じ場所に天気カードを揃える）。
    this._titleAnchor = ctx.titleAnchor ?? null;
    this._tmpV = new THREE.Vector3();

    const q = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
    const north = parseFloat(q.get("north"));
    this._northYawRad = Number.isFinite(north) ? -north * DEG2RAD : -START_FACING_BEARING_DEG * DEG2RAD;
    this._skipCalib = Number.isFinite(north) || q.has("nocalib");
    this._debug = q.has("wxdebug");
    this._calibrated = false;
    this._lastFromDeg = 0;
    // ?wxdebug の「回転向き」自己チェック用：直前の (dir, 流れ先ワールド方位)。
    this._prevSample = null;
    this._rotCheck = null;

    this._wind = {
      ok: false,
      azimuthRad: 0,
      tiltRad: RAIN_TILT_ANGLE_DEG * DEG2RAD,
      speedMs: 0,
      fromDeg: 0,
      dirLabel: "",
      placeLabel: ""
    };
    ctx.rainPhysics?.setWindSource?.(this._wind);

    // 天気カード（START/READY 中に視界内へ）。debug 時は縦を伸ばして自己チェック行を入れる。
    // TitleScreen の看板と同じくワールド固定（視界追従だと看板側と挙動が揃わず見づらいため）。
    this.panel = createPanel({
      worldWidth: 0.92,
      worldHeight: this._debug ? 0.3 : 0.2,
      pxWidth: 760,
      pxHeight: this._debug ? 252 : 168
    });
    this.group = new THREE.Group();
    this.group.add(this.panel.mesh);
    this.group.visible = false;
    this.scene.add(this.group);

    // ?wxdebug：ワールドに「雨はこっちへ流れるはず」矢印（マゼンタ）。原点まわりに置く。
    if (this._debug) {
      this._driftArrow = this._buildArrow(0xff5ad1, "雨の流れ(計算)");
      this._driftArrow.position.set(0, 1.1, 0);
      this._driftArrow.visible = false;
      this.scene.add(this._driftArrow);
    }

    this._fwd = new THREE.Vector3();
    this._attachAutoNorth();

    this._redraw();
    this._load();
    this._timer = setInterval(() => this._load(), REFRESH_MS);
  }

  /** 端末のコンパスセンサーが拾えれば、START中に1回だけ裏で北合わせする（UIなし）。 */
  _attachAutoNorth() {
    if (typeof window === "undefined" || this._skipCalib) return;
    this._onOrient = (e) => {
      if (this._calibrated || this._skipCalib) return;
      if (this.game?.state !== "START") return;
      const hasCompass = e.absolute === true || typeof e.webkitCompassHeading === "number";
      if (!hasCompass || !Number.isFinite(e.alpha)) return;
      const headingDeg = typeof e.webkitCompassHeading === "number" ? e.webkitCompassHeading : (360 - e.alpha) % 360;
      this.camera.getWorldDirection(this._fwd);
      const cameraYaw = Math.atan2(this._fwd.x, -this._fwd.z);
      this._northYawRad = cameraYaw - headingDeg * DEG2RAD;
      this._calibrated = true;
      this._wind.azimuthRad = windAzimuthRad(this._lastFromDeg, this._northYawRad);
      this._redraw();
      this._detachAutoNorth();
    };
    window.addEventListener("deviceorientationabsolute", this._onOrient);
    window.addEventListener("deviceorientation", this._onOrient);
  }

  _detachAutoNorth() {
    if (!this._onOrient) return;
    window.removeEventListener("deviceorientationabsolute", this._onOrient);
    window.removeEventListener("deviceorientation", this._onOrient);
    this._onOrient = null;
  }

  /** TitleScreen のワールド固定アンカー基準ローカル(x,y は目線相対 / z は前方が負) → ワールド。 */
  _l2wAnchor(lx, ly, lz, out) {
    const a = this._titleAnchor;
    return out.set(lx, ly, lz).applyQuaternion(a.yaw).add(a.position);
  }

  _buildArrow(colorHex, labelText) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 12), mat);
    shaft.rotation.x = -Math.PI / 2; // 軸を -Z 方向へ
    shaft.position.z = -0.21;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.13, 18), mat);
    head.rotation.x = -Math.PI / 2;
    head.position.z = -0.49;
    g.add(shaft, head);
    g.userData.mat = mat;

    const lp = createPanel({ worldWidth: 0.26, worldHeight: 0.13, pxWidth: 260, pxHeight: 130 });
    lp.draw((c, w, h) => {
      c.fillStyle = "#" + colorHex.toString(16).padStart(6, "0");
      c.font = "700 " + (labelText.length > 2 ? 34 : 84) + "px system-ui, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(labelText, w / 2, h / 2 + 4);
    });
    lp.mesh.position.set(0, 0.13, -0.55);
    g.userData.labelPanel = lp;
    g.add(lp.mesh);

    g.traverse((o) => {
      o.renderOrder = 10001;
      if (o.frustumCulled !== undefined) o.frustumCulled = false;
    });
    return g;
  }

  update(dt, ctx) {
    const st = ctx.game?.state;

    const showCard = st === "START" || st === "READY";
    if (this.group.visible !== showCard) this.group.visible = showCard;
    if (showCard && this._titleAnchor) {
      // TitleScreen の看板の右どなり、同じ高さ・同じ距離にワールド固定で置く。
      this._l2wAnchor(0.95, 0.3, -1.95, this._tmpV);
      this.group.position.copy(this._tmpV);
      this.group.quaternion.copy(this._titleAnchor.yaw);
    }

    // ?wxdebug のドリフト矢印：ゲーム/リプレイ中、計算上の雨の流れる向きを指す。
    if (this._driftArrow) {
      const showArrow = st === "PLAYING" || st === "READY" || st === "REPLAY";
      this._driftArrow.visible = showArrow;
      if (showArrow) {
        // arrow local -Z を world drift 方向へ。local -Z(rot.y=φ) → (sinφ,0,-cosφ)。
        // drift world = (cos az, _, sin az) にしたいので φ = atan2(cos az, -sin az)。
        const az = this._wind.azimuthRad;
        this._driftArrow.rotation.y = Math.atan2(Math.cos(az), -Math.sin(az));
      }
    }
  }

  async _load() {
    const q = new URLSearchParams(typeof location !== "undefined" ? location.search : "");

    const forceWind = parseFloat(q.get("wind"));
    const forceDir = parseFloat(q.get("dir"));
    if (Number.isFinite(forceWind) && Number.isFinite(forceDir)) {
      this._apply(forceWind, forceDir, "指定");
      return;
    }

    let coords;
    try {
      coords = await this._resolveCoords(q);
    } catch {
      coords = { ...FALLBACK };
    }

    try {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat.toFixed(3)}` +
        `&longitude=${coords.lon.toFixed(3)}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`;
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const ms = Number(json?.current?.wind_speed_10m);
      const fromDeg = Number(json?.current?.wind_direction_10m);
      if (!Number.isFinite(ms) || !Number.isFinite(fromDeg)) throw new Error("bad payload");
      this._apply(ms, fromDeg, coords.label);
    } catch (err) {
      console.warn("[WeatherWind] 天気の取得に失敗。既定のランダム風で進行します:", err);
      this._wind.ok = false;
      this._redraw();
    }
  }

  _resolveCoords(q) {
    const lat = parseFloat(q.get("lat"));
    const lon = parseFloat(q.get("lon"));
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return Promise.resolve({ lat, lon, label: q.get("place") || "指定地点" });
    }
    return new Promise((resolve) => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        resolve({ ...FALLBACK });
        return;
      }
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        clearTimeout(to);
        resolve(v);
      };
      const to = setTimeout(() => finish({ ...FALLBACK }), GEO_TIMEOUT_MS);
      navigator.geolocation.getCurrentPosition(
        (p) => finish({ lat: p.coords.latitude, lon: p.coords.longitude, label: "現在地" }),
        () => finish({ ...FALLBACK }),
        { timeout: GEO_TIMEOUT_MS, maximumAge: 10 * 60 * 1000 }
      );
    });
  }

  _apply(ms, fromDeg, placeLabel) {
    this._lastFromDeg = fromDeg;
    this._wind.ok = true;
    this._wind.speedMs = ms;
    this._wind.fromDeg = fromDeg;
    this._wind.azimuthRad = windAzimuthRad(fromDeg, this._northYawRad);
    this._wind.tiltRad = speedToTiltRad(ms);
    this._wind.dirLabel = compass8(fromDeg);
    this._wind.placeLabel = placeLabel;

    // ?wxdebug：dir を変えるたびに「流れ先の回転向き」を検算する。
    // dir を +Δ したら 流れ先ワールド方位も +Δ（時計回り）になるはず。逆なら符号バグ。
    if (this._debug) {
      const worldBearing = azimuthToWorldBearingDeg(this._wind.azimuthRad);
      const p = this._prevSample;
      if (p) {
        const wrap = (x) => (((x + 540) % 360) - 180);
        const dFrom = wrap(fromDeg - p.fromDeg);
        const dBearing = wrap(worldBearing - p.bearing);
        if (Math.abs(dFrom) > 1) {
          const slope = dBearing / dFrom; // +1 なら時計回りで一致
          this._rotCheck = {
            ok: slope > 0.5,
            text: `dir ${dFrom > 0 ? "+" : ""}${dFrom.toFixed(0)}° → 流れ先 ${dBearing > 0 ? "+" : ""}${dBearing.toFixed(0)}° ` +
              (slope > 0.5 ? "(時計回り) ✓" : slope < -0.5 ? "(反時計回り) ✗逆!" : "✗ズレ")
          };
        }
      }
      this._prevSample = { fromDeg, bearing: worldBearing };
    }

    this._redraw();
  }

  _redraw() {
    this.panel.draw((c, w, h) => {
      c.fillStyle = "rgba(8,16,28,0.72)";
      roundRect(c, 6, 6, w - 12, h - 12, 22);
      c.fill();
      c.strokeStyle = "rgba(124,196,255,0.5)";
      c.lineWidth = 2;
      roundRect(c, 6, 6, w - 12, h - 12, 22);
      c.stroke();

      c.textAlign = "center";
      c.textBaseline = "middle";
      const yTitle = this._debug ? 0.22 : 0.3;
      const yMain = this._debug ? 0.48 : 0.6;

      c.fillStyle = "#7cc4ff";
      c.font = "600 30px system-ui, sans-serif";
      c.fillText("本日の天気で雨の向きが変わります", w / 2, h * yTitle);

      c.font = "700 46px system-ui, sans-serif";
      if (this._wind.ok) {
        const s = this._wind.speedMs.toFixed(1);
        c.fillStyle = "#eaf1ff";
        c.fillText(`📍${this._wind.placeLabel}　${this._wind.dirLabel}の風 ${s} m/s`, w / 2, h * yMain);
      } else {
        c.fillStyle = "#9fb4d6";
        c.font = "600 34px system-ui, sans-serif";
        c.fillText("天気を取得できませんでした（既定の風で進行）", w / 2, h * yMain);
      }

      if (this._debug) {
        const nYawDeg = (this._northYawRad * 180) / Math.PI;
        const worldBearing = azimuthToWorldBearingDeg(this._wind.azimuthRad);
        c.font = "400 21px ui-monospace, monospace";
        c.fillStyle = "#8fa6c8";
        c.fillText(
          `dir=${this._wind.fromDeg.toFixed(0)}°(${compass8(this._wind.fromDeg)}風) ` +
            `→ 流れ先:${bearingLabel(worldBearing)}  nYaw=${nYawDeg.toFixed(0)}°` +
            `${this._calibrated ? "(calib)" : ""} tilt=${((this._wind.tiltRad * 180) / Math.PI).toFixed(0)}°`,
          w / 2,
          h * 0.72
        );
        c.font = "700 23px ui-monospace, monospace";
        if (this._rotCheck) {
          c.fillStyle = this._rotCheck.ok ? "#5ad19b" : "#ff6b6b";
          c.fillText(this._rotCheck.text, w / 2, h * 0.9);
        } else {
          c.fillStyle = "#8fa6c8";
          c.fillText("?wind=6&dir=0/90/180/270 と変えて回転向きを確認", w / 2, h * 0.9);
        }
      }
    });
  }

  dispose() {
    clearInterval(this._timer);
    this._detachAutoNorth();
    this._wind.ok = false;
    this.scene.remove(this.group);
    if (this._driftArrow) {
      this.scene.remove(this._driftArrow);
      this._driftArrow.userData.labelPanel?.dispose();
    }
    this.panel.dispose();
  }
}
