import {
  PLAYER_HEAD_RADIUS,
  PLAYER_HAND_RADIUS,
  PLAYER_SWAT_RADIUS,
  RAIN_DROP_RADIUS
} from "../utils/constants.js";

function distanceSq(ax, ay, az, bx, by, bz) {
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  return dx * dx + dy * dy + dz * dz;
}

export class PlayerCollider {
  constructor() {
    this.headRadius = PLAYER_HEAD_RADIUS;
    this.handRadius = PLAYER_HAND_RADIUS; // 参考値（現在は手は被弾しない）
    this.swatRadius = PLAYER_SWAT_RADIUS;
  }

  /**
   * 頭の位置と雨粒の位置配列から、被弾している雨粒を探す。
   * 手はもう被弾しない（雨を殴り飛ばす側になった）ため、判定対象は頭のみ。
   * head は { x, y, z } または null（未トラッキング）。
   * rainPositions は RainPhysics.positions（Float32Array, 3要素ごとに1粒）。
   * 戻り値: [{ rainIndex, part: "head" }]
   */
  findHits(head, rainPositions) {
    if (!head) return [];
    const hits = [];
    const r = this.headRadius + RAIN_DROP_RADIUS;
    const rr = r * r;
    const count = rainPositions.length / 3;
    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      if (
        distanceSq(
          head.x,
          head.y,
          head.z,
          rainPositions[idx],
          rainPositions[idx + 1],
          rainPositions[idx + 2]
        ) <= rr
      ) {
        hits.push({ rainIndex: i, part: "head" });
      }
    }
    return hits;
  }

  /**
   * 左右の手が「殴り飛ばした」雨粒を探す。手は被弾しない代わりに、swatRadius 内の
   * 雨粒を弾き飛ばす（呼び出し側で respawn する）。
   * handLeft / handRight は { x, y, z } または null。
   * 戻り値: [{ rainIndex, part: "handLeft"|"handRight", pos: {x,y,z} }]（FX 用に着弾位置つき）
   */
  findSwats(handLeft, handRight, rainPositions) {
    const hands = [
      handLeft && { pos: handLeft, part: "handLeft" },
      handRight && { pos: handRight, part: "handRight" }
    ].filter(Boolean);
    if (hands.length === 0) return [];

    const r = this.swatRadius + RAIN_DROP_RADIUS;
    const rr = r * r;
    const count = rainPositions.length / 3;
    const swats = [];
    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      const rx = rainPositions[idx];
      const ry = rainPositions[idx + 1];
      const rz = rainPositions[idx + 2];
      for (const h of hands) {
        if (distanceSq(h.pos.x, h.pos.y, h.pos.z, rx, ry, rz) <= rr) {
          swats.push({ rainIndex: i, part: h.part, pos: { x: rx, y: ry, z: rz } });
          break; // 1粒につき1回で十分
        }
      }
    }
    return swats;
  }
}
