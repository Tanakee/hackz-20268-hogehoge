import * as THREE from "three";

// 使い回しのスクラッチ（毎フレームの new を避ける）
const _toT = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * 2ボーン解析IK（余弦定理）。
 * 肩 `S` から目標 `T` へ、長さ `L1`(上腕) + `L2`(前腕) の腕を伸ばしたときの
 * 肘位置と各セグメントのワールド方向を求める。肘は `poleDir` の側へ曲がる。
 *
 * 結果は `out.elbow` / `out.dirUpper` / `out.dirLower` に書き込む（戻り値も out）。
 * ボーンの回転設定は呼び出し側（PlayerAvatar）が行う。
 *
 * @param {THREE.Vector3} S       肩（上腕の付け根）ワールド座標
 * @param {THREE.Vector3} T       手先の目標ワールド座標
 * @param {number} L1             上腕の長さ
 * @param {number} L2             前腕の長さ
 * @param {THREE.Vector3} poleDir 肘を向けたいおおよそのワールド方向（下・外向きなど）
 * @param {{elbow:THREE.Vector3,dirUpper:THREE.Vector3,dirLower:THREE.Vector3}} out
 */
export function solveTwoBone(S, T, L1, L2, poleDir, out) {
  _toT.subVectors(T, S);
  let d = _toT.length();
  // 届かない / 近すぎる場合は解が無いので可動域にクランプ（腕が伸びきる / たたみきる）
  const dMin = Math.abs(L1 - L2) + 1e-4;
  const dMax = L1 + L2 - 1e-4;
  d = Math.min(Math.max(d, dMin), dMax);
  _axis.copy(_toT).normalize(); // S→T 方向

  // 上腕が S→T 直線となす角 K（余弦定理）
  const cosK = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
  const K = Math.acos(Math.min(1, Math.max(-1, cosK)));

  // poleDir を axis に直交化 → 曲げ平面内の「肘を向ける向き」
  _pole.copy(poleDir).addScaledVector(_axis, -poleDir.dot(_axis));
  if (_pole.lengthSq() < 1e-8) {
    // poleDir が axis とほぼ平行だった場合のフォールバック
    _pole.set(0, 1, 0).addScaledVector(_axis, -_axis.y);
    if (_pole.lengthSq() < 1e-8) _pole.set(1, 0, 0).addScaledVector(_axis, -_axis.x);
  }
  _pole.normalize();

  // axis を「pole 側」へ K だけ回した向き = 上腕方向
  _n.crossVectors(_axis, _pole).normalize(); // この軸まわりに +K 回すと axis が pole へ寄る
  _q.setFromAxisAngle(_n, K);
  out.dirUpper.copy(_axis).applyQuaternion(_q).normalize();

  out.elbow.copy(S).addScaledVector(out.dirUpper, L1);
  out.dirLower.subVectors(T, out.elbow).normalize();
  return out;
}

export function makeIKScratch() {
  return {
    elbow: new THREE.Vector3(),
    dirUpper: new THREE.Vector3(),
    dirLower: new THREE.Vector3()
  };
}
