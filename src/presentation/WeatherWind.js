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
 *   分からない。合わせ方は2通り（どちらも任意。やらなければ「開始時に北を向いていた」前提）：
 *     1) ?north=NN … スタート時に頭が向いている方角（北=0・東=90・時計回り）を手動指定
 *     2) 起動時キャリブUI … START中、矢印を出して「真北に向けてグリップ（squeeze）」。
 *        その瞬間の頭のワールドyawを北の基準として記録する。
 *        ※ StartScreen が「開始」にトリガー(select)を使うので、こちらは squeeze で拾う。
 *        ※ キャリブせずトリガーを引けば従来どおり開始（キャリブは任意ステップ）。
 *
 * core への足あとは RainPhysics.setWindSource(this._wind) の1呼び出しのみ。
 * this._wind は「参照は固定・中身を非同期で書き換える」オブジェクト。
 * ※ presentation → core はライフサイクル/セッター呼び出しのみ（DEVPLAN 接続ルール）。
 */

// 天気が取れなかったとき・位置が分からないときに使う座標（会場）。
const FALLBACK = { lat: 33.79434, lon: 130.63585, label: "会場" };
// スタート時にプレイヤーの頭が向いている方角（度・北=0・東=90・時計回り）の既定値。
const START_FACING_BEARING_DEG = 0;
// 斜め雨の傾き角の上限（度）。これ以上倒すと不自然かつスポーンが大きくずれる。
const MAX_TILT_DEG = 45;
const REFRESH_MS = 5 * 60 * 1000;
const GEO_TIMEOUT_MS = 4000;
const DEG2RAD = Math.PI / 180;

const DIR8 = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];

/** 気象の「風向」（風が吹いてくる方角, 度・0=北・時計回り）を8方位の日本語に。 */
function compass8(fromDeg) {
  const i = Math.round((((fromDeg % 360) + 360) % 360) / 45) % 8;
  return DIR8[i];
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

/** 実風速(m/s) → 斜めの傾き角。無風で約6°、約6m/sで既定の30°、上限 MAX_TILT_DEG。 */
function speedToTiltRad(ms) {
  const deg = Math.max(6, Math.min(MAX_TILT_DEG, 6 + ms * 4));
  return deg * DEG2RAD;
}

export class WeatherWind {
  constructor(scene, ctx) {
    this.camera = ctx.camera;
    this.game = ctx.game;
    this.controllers = ctx.controllers ?? [];

    const q = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
    const north = parseFloat(q.get("north"));
    // 「真北」に対応するワールドyaw。?north=F があれば -F、なければ 0（＝開始時に北向き前提）。
    this._northYawRad = Number.isFinite(north) ? -north * DEG2RAD : -START_FACING_BEARING_DEG * DEG2RAD;
    // ?north= 手動指定 or ?nocalib のときはキャリブUIを出さない。
    this._skipCalib = Number.isFinite(north) || q.has("nocalib");
    this._debug = q.has("wxdebug");
    this._calibrated = false;
    this._confirmT = 0; // キャリブ確定後の「✓」表示の残り秒

    this._lastFromDeg = 0; // 直近の風向（キャリブ時に azimuth を計算し直すため）

    // RainPhysics に渡す参照。中身だけ後から書き換える。
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

    // 天気カード（START/READY 中に視界内へ）
    this.panel = createPanel({ worldWidth: 0.92, worldHeight: 0.2, pxWidth: 760, pxHeight: 168 });
    this.group = new THREE.Group();
    this.group.position.set(0, 0.34, -1.4);
    this.group.add(this.panel.mesh);
    this.group.visible = false;
    this.camera.add(this.group);

    // 北キャリブUI（矢印＋説明パネル）。START 中・未キャリブのときだけ表示。
    this.calibGroup = new THREE.Group();
    this.calibGroup.visible = false;
    this._arrow = this._buildArrow();
    this.calibGroup.add(this._arrow);
    this.calibPanel = createPanel({ worldWidth: 0.7, worldHeight: 0.17, pxWidth: 620, pxHeight: 150 });
    this.calibPanel.mesh.position.set(0, 0.14, 0);
    this.calibGroup.add(this.calibPanel.mesh);
    this.calibGroup.position.set(0, -0.12, -1.0);
    this.camera.add(this.calibGroup);
    this._drawCalibPanel(false);

    this._fwd = new THREE.Vector3();
    this._onSqueeze = () => this._calibrateNow();
    for (const c of this.controllers) c?.addEventListener?.("squeezestart", this._onSqueeze);

    this._redraw();
    this._load();
    this._timer = setInterval(() => this._load(), REFRESH_MS);
  }

  _buildArrow() {
    const g = new THREE.Group();
    this._arrowMat = new THREE.MeshBasicMaterial({
      color: 0x7cf0ff,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 12), this._arrowMat);
    shaft.rotation.x = -Math.PI / 2; // 軸を -Z 方向へ
    shaft.position.z = -0.21;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.13, 18), this._arrowMat);
    head.rotation.x = -Math.PI / 2;
    head.position.z = -0.49;
    g.add(shaft, head);

    // 先端の「北」ラベル
    const lp = createPanel({ worldWidth: 0.16, worldHeight: 0.16, pxWidth: 128, pxHeight: 128 });
    lp.draw((c, w, h) => {
      c.fillStyle = "#7cf0ff";
      c.font = "700 84px system-ui, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("北", w / 2, h / 2 + 4);
    });
    lp.mesh.position.set(0, 0.12, -0.55);
    this._labelPanel = lp;
    g.add(lp.mesh);

    g.traverse((o) => {
      o.renderOrder = 10001;
      if (o.frustumCulled !== undefined) o.frustumCulled = false;
    });
    return g;
  }

  _drawCalibPanel(confirmed) {
    this.calibPanel.draw((c, w, h) => {
      c.fillStyle = "rgba(8,16,28,0.74)";
      roundRect(c, 4, 4, w - 8, h - 8, 18);
      c.fill();
      c.strokeStyle = "rgba(124,240,255,0.55)";
      c.lineWidth = 2;
      roundRect(c, 4, 4, w - 8, h - 8, 18);
      c.stroke();
      c.textAlign = "center";
      c.textBaseline = "middle";
      if (confirmed) {
        c.fillStyle = "#5ad19b";
        c.font = "700 40px system-ui, sans-serif";
        c.fillText("✓ 北を設定しました", w / 2, h / 2);
      } else {
        c.fillStyle = "#eaf1ff";
        c.font = "600 32px system-ui, sans-serif";
        c.fillText("この矢印を真北に向けて", w / 2, h * 0.36);
        c.fillStyle = "#7cf0ff";
        c.font = "700 34px system-ui, sans-serif";
        c.fillText("グリップを握る", w / 2, h * 0.62);
        c.fillStyle = "#8fa6c8";
        c.font = "400 22px system-ui, sans-serif";
        c.fillText("スキップ：そのままトリガーで開始", w / 2, h * 0.86);
      }
    });
  }

  _calibrateNow() {
    if (this._calibrated || this._skipCalib) return;
    if (this.game?.state !== "START") return;
    // 頭の向いているワールド方向（水平）から yaw を取る。yaw 0 = -Z, +90° = +X。
    this.camera.getWorldDirection(this._fwd);
    this._northYawRad = Math.atan2(this._fwd.x, -this._fwd.z);
    this._calibrated = true;
    this._confirmT = 1.5;
    if (this._arrowMat) this._arrowMat.color.set(0x5ad19b);
    this._drawCalibPanel(true);
    // 直近の風向で azimuth を計算し直す
    this._wind.azimuthRad = windAzimuthRad(this._lastFromDeg, this._northYawRad);
    this._redraw();
  }

  update(dt, ctx) {
    const st = ctx.game?.state;

    const showCard = st === "START" || st === "READY";
    if (this.group.visible !== showCard) this.group.visible = showCard;

    if (this._confirmT > 0) this._confirmT -= dt;
    const showCalib =
      !this._skipCalib && st === "START" && (!this._calibrated || this._confirmT > 0);
    if (this.calibGroup.visible !== showCalib) this.calibGroup.visible = showCalib;
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
      c.fillStyle = "#7cc4ff";
      c.font = "600 30px system-ui, sans-serif";
      c.fillText("本日の天気で雨の向きが変わります", w / 2, h * 0.3);

      c.font = "700 46px system-ui, sans-serif";
      if (this._wind.ok) {
        const s = this._wind.speedMs.toFixed(1);
        c.fillStyle = "#eaf1ff";
        c.fillText(`📍${this._wind.placeLabel}　${this._wind.dirLabel}の風 ${s} m/s`, w / 2, h * 0.6);
      } else {
        c.fillStyle = "#9fb4d6";
        c.font = "600 34px system-ui, sans-serif";
        c.fillText("天気を取得できませんでした（既定の風で進行）", w / 2, h * 0.6);
      }

      if (this._debug) {
        const a = this._wind.azimuthRad;
        c.fillStyle = "#8fa6c8";
        c.font = "400 20px ui-monospace, monospace";
        c.fillText(
          `from=${this._wind.fromDeg.toFixed(0)}° northYaw=${((this._northYawRad * 180) / Math.PI).toFixed(0)}° ` +
            `${this._calibrated ? "(calib)" : ""} → drift(x,z)=(${Math.cos(a).toFixed(2)}, ${Math.sin(a).toFixed(2)}) ` +
            `tilt=${((this._wind.tiltRad * 180) / Math.PI).toFixed(0)}°`,
          w / 2,
          h * 0.86
        );
      }
    });
  }

  dispose() {
    clearInterval(this._timer);
    for (const c of this.controllers) c?.removeEventListener?.("squeezestart", this._onSqueeze);
    this._wind.ok = false; // RainPhysics を既定挙動へ戻す
    this.camera.remove(this.group);
    this.camera.remove(this.calibGroup);
    this.panel.dispose();
    this.calibPanel.dispose();
    this._labelPanel?.dispose();
  }
}
