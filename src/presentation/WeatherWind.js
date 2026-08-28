import * as THREE from "three";
import { RAIN_TILT_ANGLE_DEG } from "../utils/constants.js";
import { createPanel, roundRect } from "./_panel.js";

/**
 * 「技術の無駄遣い」枠：本物の天気（風速・風向）を取ってきて、ゲーム内の斜め雨の
 * 向きと傾きに反映させる。外の天気が難易度を左右しても誰も得しないが、
 * on-theme（妄想の雨に現実の風を吹かせる）なのでやる。
 *
 * - データ元：Open-Meteo（APIキー不要・CORS開放・無料）
 * - 位置：?lat=&lon= のURL指定 → geolocation（ヘッドセットでは失敗しがち）→ FALLBACK（会場）
 * - デモ用の強制指定：?wind=12&dir=270 （風速 m/s ・ 風向 deg。会場が無風でも演出できる）
 * - 北合わせ：?north=NN （スタート時に頭が向いている方角。北=0・東=90・時計回り）。
 *   WebXR は方位磁石を持たないので、ブースで1回測ってこの値を渡す運用。
 * - 取得できなければ ok=false のまま。RainPhysics は従来どおりのランダム風で動く。
 *
 * core への足あとは RainPhysics.setWindSource(this._wind) の1呼び出しのみ。
 * this._wind は「参照は固定・中身を非同期で書き換える」オブジェクトで、
 * RainPhysics 側は斜めモードに切り替わるたびに最新の中身を読む。
 * ※ presentation → core はライフサイクル/セッター呼び出しのみ（DEVPLAN 接続ルール）。
 */

// 天気が取れなかったとき・位置が分からないときに使う座標（会場）。
const FALLBACK = { lat: 33.79434, lon: 130.63585, label: "会場" };
// スタート時にプレイヤーの頭が向いている方角（度・北=0・東=90・時計回り）の既定値。
// ?north=NN で上書きできる。0 = 「北を向いてスタートした」前提。
const START_FACING_BEARING_DEG = 0;
// 斜め雨の傾き角の上限（度）。これ以上倒すと「ほぼ真横」で不自然かつスポーンが大きくずれる。
const MAX_TILT_DEG = 45;
// 展示中ずっと開きっぱなしでも“今の風”に追従するよう定期的に取り直す。
const REFRESH_MS = 5 * 60 * 1000;
// geolocation がヘッドセットで返ってこないことがあるので短めに打ち切る。
const GEO_TIMEOUT_MS = 4000;

const DIR8 = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];

/** 気象の「風向」（風が吹いてくる方角, 度・0=北・時計回り）を8方位の日本語に。 */
function compass8(fromDeg) {
  const i = Math.round((((fromDeg % 360) + 360) % 360) / 45) % 8;
  return DIR8[i];
}

/**
 * 現実のコンパス風向 → ゲーム内の水平ドリフト方向（RainPhysics が使う「数学角」。windX=cos, windZ=sin）。
 *
 * - fromDeg   : 気象の「風向」= 風が吹いてくる方角。雨が流される向きは +180。
 * - facingDeg : スタート時にプレイヤーの頭が向いていた方角。
 *   → 風のドリフト方向を「プレイヤーの正面(-Z)からの時計回りの相対角」に変換する。
 * - 相対角 θ（プレイヤー正面=0・右回り）→ ワールド：正面 -Z、右 +X なので
 *   worldX = sin(θ)、worldZ = -cos(θ)。
 *
 * facingDeg=0（北を向いてスタート）なら「北=-Z、東=+X」の素直な対応になる。
 */
function bearingToAzimuthRad(fromDeg, facingDeg) {
  const relDeg = fromDeg + 180 - facingDeg;
  const r = (relDeg * Math.PI) / 180;
  const worldX = Math.sin(r);
  const worldZ = -Math.cos(r);
  return Math.atan2(worldZ, worldX);
}

/** 実風速(m/s) → 斜めの傾き角。無風で約6°、約6m/sで既定の30°、上限 MAX_TILT_DEG。 */
function speedToTiltRad(ms) {
  const deg = Math.max(6, Math.min(MAX_TILT_DEG, 6 + ms * 4));
  return (deg * Math.PI) / 180;
}

export class WeatherWind {
  constructor(scene, ctx) {
    this.camera = ctx.camera;
    this.game = ctx.game;

    const q = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
    const north = parseFloat(q.get("north"));
    this._facingDeg = Number.isFinite(north) ? north : START_FACING_BEARING_DEG;
    this._debug = q.has("wxdebug");

    // RainPhysics に渡す参照。中身だけ後から書き換える。
    this._wind = {
      ok: false,
      azimuthRad: 0,
      tiltRad: (RAIN_TILT_ANGLE_DEG * Math.PI) / 180,
      speedMs: 0,
      fromDeg: 0,
      dirLabel: "",
      placeLabel: ""
    };
    ctx.rainPhysics?.setWindSource?.(this._wind);

    // START / READY のときだけ見せる小さな情報カード（視界追従）。
    this.panel = createPanel({ worldWidth: 0.92, worldHeight: 0.2, pxWidth: 760, pxHeight: 168 });
    this.group = new THREE.Group();
    this.group.position.set(0, 0.34, -1.4);
    this.group.add(this.panel.mesh);
    this.group.visible = false;
    this.camera.add(this.group);

    this._redraw();
    this._load();
    this._timer = setInterval(() => this._load(), REFRESH_MS);
  }

  update(_dt, ctx) {
    const st = ctx.game?.state;
    const show = st === "START" || st === "READY";
    if (this.group.visible !== show) this.group.visible = show;
  }

  async _load() {
    const q = new URLSearchParams(typeof location !== "undefined" ? location.search : "");

    // デモ用の強制指定（会場が無風でも斜め雨を見せられる）
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
    this._wind.ok = true;
    this._wind.speedMs = ms;
    this._wind.fromDeg = fromDeg;
    this._wind.azimuthRad = bearingToAzimuthRad(fromDeg, this._facingDeg);
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
          `from=${this._wind.fromDeg.toFixed(0)}° north=${this._facingDeg.toFixed(0)}° ` +
            `→ drift(x,z)=(${Math.cos(a).toFixed(2)}, ${Math.sin(a).toFixed(2)}) ` +
            `tilt=${((this._wind.tiltRad * 180) / Math.PI).toFixed(0)}°`,
          w / 2,
          h * 0.86
        );
      }
    });
  }

  dispose() {
    clearInterval(this._timer);
    this._wind.ok = false; // RainPhysics を既定挙動へ戻す
    this.camera.remove(this.group);
    this.panel.dispose();
  }
}
