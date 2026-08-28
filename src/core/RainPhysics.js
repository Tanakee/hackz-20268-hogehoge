import {
  RAIN_COUNT_MIN,
  RAIN_COUNT_MAX,
  RAIN_SPEED_SLOW,
  RAIN_SPAWN_RADIUS,
  RAIN_SPAWN_HEIGHT,
  RAIN_GROUND_Y,
  RAIN_RAMP_UP_DURATION,
  RAIN_MODE_DURATION,
  RAIN_MODE_TRANSITION,
  RAIN_TILT_ANGLE_DEG,
  GAME_DURATION
} from "../utils/constants.js";

// まだ投入されていない雨粒を、描画にも当たり判定にも影響しない位置に隠しておくための高さ。
const HIDDEN_Y = -50; // m
const TILT_ANGLE_RAD = (RAIN_TILT_ANGLE_DEG * Math.PI) / 180;

export class RainPhysics {
  constructor(count = RAIN_COUNT_MAX, speed = RAIN_SPEED_SLOW) {
    this.count = count; // 配列の確保サイズ（＝終盤の密度上限）。実際に降っている数は_activeCount。
    this.speed = speed;
    this.positions = new Float32Array(count * 3);
    // 目標モード（presentationが見た目のヒントとして参照できるよう公開）。
    this.tilted = false;
    // 実際に雨粒に適用される水平速度。目標値へ瞬時に切り替わらず、
    // RAIN_MODE_TRANSITION秒かけてなめらかに変化する（風が強まる/収まるイメージ）。
    this.windX = 0; // m/s
    this.windZ = 0;
    // 実際の天気から得た風（presentation の WeatherWind）。未設定なら従来のランダム風。
    this._windSource = null;
    this._resetAll();
  }

  /**
   * 実際の天気から得た風を斜めモードに反映するためのフック。
   * src = { ok:boolean, azimuthRad:number, tiltRad:number }。中身は非同期で書き換わるので毎回読む。
   * 未設定 or ok=false のときは従来どおりランダム方向＋固定傾き（RAIN_TILT_ANGLE_DEG）で動く。
   */
  setWindSource(src) {
    this._windSource = src;
  }

  /** 指定した雨粒を強制的に再出現させる。被弾した雨粒をその場に留まらせない（多段ヒット防止）ために公開。 */
  respawn(index) {
    // 「スポーン位置」を原点中心の半径内にすると、斜めモードでは風で流されるうちに
    // プレイヤーの身長帯に到達する頃には範囲ごとプレイヤーからずれてしまい、
    // ほとんど当たらなくなる（実機フィードバックにより発覚）。
    // そこで「地面に到達する時点の位置」の方を原点中心の半径内にランダムに決め、
    // そこから風のドリフト分だけ逆算してスポーン位置を求める。
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * RAIN_SPAWN_RADIUS;
    const groundX = Math.cos(angle) * radius;
    const groundZ = Math.sin(angle) * radius;
    const fallTime = (RAIN_SPAWN_HEIGHT - RAIN_GROUND_Y) / this.speed;

    const i = index * 3;
    this.positions[i] = groundX - this.windX * fallTime;
    this.positions[i + 1] = RAIN_SPAWN_HEIGHT;
    this.positions[i + 2] = groundZ - this.windZ * fallTime;
  }

  _hide(index) {
    const i = index * 3;
    this.positions[i] = 0;
    this.positions[i + 1] = HIDDEN_Y;
    this.positions[i + 2] = 0;
  }

  _resetAll() {
    this._activeCount = 0;
    this._spawnTimer = 0;
    this._spawnInterval = RAIN_RAMP_UP_DURATION / RAIN_COUNT_MIN;
    this._playElapsed = 0; // 難易度上昇（密度ランプ）用の経過時間
    this._modeTimer = 0;
    this.tilted = false;
    this.windX = 0;
    this.windZ = 0;
    this._targetWindX = 0;
    this._targetWindZ = 0;
    for (let i = 0; i < this.count; i++) {
      this._hide(i);
    }
  }

  /**
   * 現在の経過時間から「今出ているべき雨粒数」を求める。
   * 最初のRAIN_RAMP_UP_DURATION秒でRAIN_COUNT_MINまで一気に投入し（開始直後に
   * 囲まれる問題の対策、従来通り）、その後はGAME_DURATIONいっぱいまでかけて
   * RAIN_COUNT_MAXへ増やす（時間経過による難易度上昇）。
   * 線形に増やすと変化がほぼ体感できなかった（実機フィードバック）ため、
   * 増加量を2乗カーブ（序盤は緩やか、終盤に増加が集中）にして、
   * 「終盤ほど密度が上がって明らかに難しくなる」感覚を作る。
   */
  _targetActiveCount() {
    if (this._playElapsed < RAIN_RAMP_UP_DURATION) {
      return Math.min(RAIN_COUNT_MIN, Math.ceil((this._playElapsed / RAIN_RAMP_UP_DURATION) * RAIN_COUNT_MIN));
    }
    const span = Math.max(1e-6, GAME_DURATION - RAIN_RAMP_UP_DURATION);
    const progress = Math.min(1, (this._playElapsed - RAIN_RAMP_UP_DURATION) / span);
    return Math.round(RAIN_COUNT_MIN + (RAIN_COUNT_MAX - RAIN_COUNT_MIN) * progress * progress);
  }

  _pickWindTarget() {
    const src = this._windSource;
    let dir;
    let horizontalSpeed;
    if (src && src.ok) {
      // 実際の天気：風向はそのまま、傾き角は実風速から決めた値（tiltRad）を使う。
      dir = src.azimuthRad;
      horizontalSpeed = this.speed * Math.tan(src.tiltRad);
    } else {
      // 従来どおり：ランダムな向き＋固定傾き。
      dir = Math.random() * Math.PI * 2;
      horizontalSpeed = this.speed * Math.tan(TILT_ANGLE_RAD);
    }
    this._targetWindX = Math.cos(dir) * horizontalSpeed;
    this._targetWindZ = Math.sin(dir) * horizontalSpeed;
  }

  update(dt) {
    this._playElapsed += dt;

    // 垂直/斜めモードをRAIN_MODE_DURATIONごとに切り替える（「風向き」が変わるイメージ）。
    // 同時に混在させるのは非現実的なため、一括で切り替える。
    this._modeTimer += dt;
    if (this._modeTimer >= RAIN_MODE_DURATION) {
      this._modeTimer = 0;
      this.tilted = !this.tilted;
      if (this.tilted) {
        this._pickWindTarget();
      } else {
        this._targetWindX = 0;
        this._targetWindZ = 0;
      }
    }

    // 風速は目標値へ瞬時に切り替えず、RAIN_MODE_TRANSITION秒かけてなめらかに
    // 近づける（「風が強まる/収まる」ように見せる。実機フィードバックにより追加。
    // パキッと瞬間的にモードが切り替わるのは不自然という指摘のため）。
    const ease = Math.min(1, dt / RAIN_MODE_TRANSITION);
    this.windX += (this._targetWindX - this.windX) * ease;
    this.windZ += (this._targetWindZ - this.windZ) * ease;

    // 雨粒を目標数（_targetActiveCount、時間経過とともに増える）に達するまで
    // 少しずつ投入する。一気に全部出現させると「開始直後から囲まれている」
    // 「地面到達→再出現のタイミングが揃って段階的に降ってくる」という2つの
    // 問題が起きるため、投入自体を時間分散させる。
    const target = this._targetActiveCount();
    this._spawnTimer += dt;
    while (this._activeCount < target && this._spawnTimer >= this._spawnInterval) {
      this._spawnTimer -= this._spawnInterval;
      this.respawn(this._activeCount);
      this._activeCount++;
    }

    for (let i = 0; i < this._activeCount; i++) {
      const idx = i * 3;
      this.positions[idx + 1] -= this.speed * dt;
      this.positions[idx] += this.windX * dt;
      this.positions[idx + 2] += this.windZ * dt;
      if (this.positions[idx + 1] <= RAIN_GROUND_Y) {
        this.respawn(i);
      }
    }
  }

  reset() {
    this._resetAll();
  }
}
