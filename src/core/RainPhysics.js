import { RAIN_COUNT, RAIN_SPEED_SLOW } from "../utils/constants.js";

// プレイヤー（local-floor原点）を中心とした、雨の出現範囲。
const SPAWN_RADIUS = 1.2; // m（xz平面）
const SPAWN_HEIGHT = 2.2; // m（初期出現時はこの高さまでの間にランダム配置）
const GROUND_Y = 0;       // m（この高さまで落ちたら再出現）

export class RainPhysics {
  constructor(count = RAIN_COUNT, speed = RAIN_SPEED_SLOW) {
    this.count = count;
    this.speed = speed;
    this.positions = new Float32Array(count * 3);
    this._resetAll();
  }

  _respawn(index) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * SPAWN_RADIUS;
    const i = index * 3;
    this.positions[i] = Math.cos(angle) * radius;
    this.positions[i + 1] = SPAWN_HEIGHT;
    this.positions[i + 2] = Math.sin(angle) * radius;
  }

  _resetAll() {
    for (let i = 0; i < this.count; i++) {
      this._respawn(i);
      // 起動直後に全ての雨が同じ高さから降り始めると不自然なため、
      // 初期化時のみ高さをランダムにばらけさせる。
      this.positions[i * 3 + 1] = Math.random() * SPAWN_HEIGHT;
    }
  }

  update(dt) {
    for (let i = 0; i < this.count; i++) {
      const yIndex = i * 3 + 1;
      this.positions[yIndex] -= this.speed * dt;
      if (this.positions[yIndex] <= GROUND_Y) {
        this._respawn(i);
      }
    }
  }

  reset() {
    this._resetAll();
  }
}
