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
    this.handRadius = PLAYER_HAND_RADIUS;
    this.swatRadius = PLAYER_SWAT_RADIUS;
  }

  /**
   * 頭・左右コントローラーの位置と雨粒の位置配列から、被弾している雨粒を探す。
   * head / handLeft / handRight は { x, y, z } または null（未トラッキング）。
   * 「殴り飛ばしモード」では呼び出し側が hand を null で渡す（頭のみ被弾）。
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

  /**
   * 「殴り飛ばしモード」専用。左右の手が swatRadius 内に捉えた雨粒を返す。
   * このモードでは手は被弾せず、代わりにこの雨粒を弾き飛ばす（呼び出し側で respawn）。
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
