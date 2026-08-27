import {
  RAIN_COUNT,
  RAIN_SPEED_SLOW,
  RAIN_SPAWN_RADIUS,
  RAIN_SPAWN_HEIGHT,
  RAIN_GROUND_Y
} from "../utils/constants.js";

export class RainPhysics {
  constructor(count = RAIN_COUNT, speed = RAIN_SPEED_SLOW) {
    this.count = count;
    this.speed = speed;
    this.positions = new Float32Array(count * 3);
    this._resetAll();
  }

  _respawn(index) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * RAIN_SPAWN_RADIUS;
    const i = index * 3;
    this.positions[i] = Math.cos(angle) * radius;
    this.positions[i + 1] = RAIN_SPAWN_HEIGHT;
    this.positions[i + 2] = Math.sin(angle) * radius;
  }

  _resetAll() {
    for (let i = 0; i < this.count; i++) {
      this._respawn(i);
      // 起動直後に全ての雨が同じ高さから降り始めると不自然なため、
      // 初期化時のみ高さをランダムにばらけさせる。
      this.positions[i * 3 + 1] = Math.random() * RAIN_SPAWN_HEIGHT;
    }
  }

  update(dt) {
    for (let i = 0; i < this.count; i++) {
      const yIndex = i * 3 + 1;
      this.positions[yIndex] -= this.speed * dt;
      if (this.positions[yIndex] <= RAIN_GROUND_Y) {
        this._respawn(i);
      }
    }
  }

  reset() {
    this._resetAll();
  }
}
