import { PLAYER_HEAD_RADIUS, PLAYER_HAND_RADIUS, RAIN_DROP_RADIUS } from "../utils/constants.js";

function distanceSq(ax, ay, az, bx, by, bz) {
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  return dx * dx + dy * dy + dz * dz;
}

export class PlayerCollider {
  constructor() {
    this.headRadius = PLAYER_HEAD_RADIUS;
    this.handRadius = PLAYER_HAND_RADIUS;
  }

  /**
   * 頭・左右コントローラーの位置と雨粒の位置配列から、被弾している雨粒を探す。
   * head / handLeft / handRight は { x, y, z } または null（未トラッキング）。
   * rainPositions は RainPhysics.positions（Float32Array, 3要素ごとに1粒）。
   * 戻り値: [{ rainIndex, part }] （1フレームで複数被弾もあり得るため配列）
   */
  findHits(head, handLeft, handRight, rainPositions) {
    const targets = [
      head && { pos: head, radius: this.headRadius, part: "head" },
      handLeft && { pos: handLeft, radius: this.handRadius, part: "handLeft" },
      handRight && { pos: handRight, radius: this.handRadius, part: "handRight" }
    ].filter(Boolean);

    if (targets.length === 0) return [];

    const hits = [];
    const count = rainPositions.length / 3;

    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      const rx = rainPositions[idx];
      const ry = rainPositions[idx + 1];
      const rz = rainPositions[idx + 2];

      for (const target of targets) {
        const r = target.radius + RAIN_DROP_RADIUS;
        if (distanceSq(target.pos.x, target.pos.y, target.pos.z, rx, ry, rz) <= r * r) {
          hits.push({ rainIndex: i, part: target.part });
          break; // 1粒につき1回のヒットで十分
        }
      }
    }

    return hits;
  }
}
