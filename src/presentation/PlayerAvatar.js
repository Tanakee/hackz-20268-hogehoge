import * as THREE from "three";

// 棒人間のパーツ寸法（m）
const HEAD_R = 0.12;
const HAND_R = 0.05;
const BONE_R = 0.018;
const NECK_DROP = 0.15; // 頭の中心から首までの下げ幅
const SHOULDER_HALF = 0.18; // 首から左右の肩までの距離
const HIP_Y = 0.95; // 腰の高さ（脚は固定ポーズ）
const FOOT_HALF = 0.11;
const COLOR = 0x9fe1ff;

/**
 * リプレイ時だけ表示する棒人間アバター。
 * 記録データ（ctx.replayer.frame.head / handLeft / handRight）に頭と手を追従させ、
 * 胴体・脚は「頭の真下」を基準にそれっぽく合成する（脚は固定ポーズ）。GAMESPEC 6.2。
 */
export class PlayerAvatar {
  constructor(scene, ctx) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    const mat = new THREE.MeshBasicMaterial({
      color: COLOR,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      toneMapped: false
    });
    this._mat = mat;

    const sphere = (r) => new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat);
    this._head = sphere(HEAD_R);
    this._handL = sphere(HAND_R);
    this._handR = sphere(HAND_R);

    // 棒（単位高さの円柱を _placeBone で伸縮・回転させる）
    this._bones = {};
    for (const name of ["spine", "armL", "armR", "legL", "legR"]) {
      const bone = new THREE.Mesh(new THREE.CylinderGeometry(BONE_R, BONE_R, 1, 6), mat);
      this._bones[name] = bone;
      this.group.add(bone);
    }
    this.group.add(this._head, this._handL, this._handR);

    // 使い回し用の一時ベクトル（毎フレームの new を避ける）
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  _toVec(p, out) {
    return p ? out.set(p.x, p.y, p.z) : null;
  }

  /** 単位円柱 bone を from→to の線分に合わせる */
  _placeBone(bone, from, to) {
    const d = this._d.subVectors(to, from);
    const len = d.length() || 1e-4;
    bone.position.copy(from).addScaledVector(d, 0.5);
    bone.scale.set(1, len, 1);
    bone.quaternion.setFromUnitVectors(this._up, d.normalize());
  }

  update(_dt, ctx) {
    const active = ctx.game?.state === "REPLAY";
    const frame = ctx.replayer?.frame;
    const head = active && frame ? this._toVec(frame.head, this._a) : null;

    if (!head) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;

    // 頭
    this._head.position.copy(head);
    if (frame.head.qx != null) {
      this._head.quaternion.set(frame.head.qx, frame.head.qy, frame.head.qz, frame.head.qw);
    }

    // 首・肩・腰・足（頭の真下basis）
    const neck = this._b.set(head.x, head.y - NECK_DROP, head.z);
    const hip = new THREE.Vector3(head.x, HIP_Y, head.z);
    const shoulderL = new THREE.Vector3(neck.x - SHOULDER_HALF, neck.y, neck.z);
    const shoulderR = new THREE.Vector3(neck.x + SHOULDER_HALF, neck.y, neck.z);
    const footL = new THREE.Vector3(head.x - FOOT_HALF, 0, head.z);
    const footR = new THREE.Vector3(head.x + FOOT_HALF, 0, head.z);

    this._placeBone(this._bones.spine, neck, hip);
    this._placeBone(this._bones.legL, hip, footL);
    this._placeBone(this._bones.legR, hip, footR);

    // 手（記録が null のときは肩から自然に下ろす）
    const handL = this._toVec(frame.handLeft, new THREE.Vector3());
    const handR = this._toVec(frame.handRight, new THREE.Vector3());
    const restL = handL || shoulderL.clone().setY(shoulderL.y - 0.45);
    const restR = handR || shoulderR.clone().setY(shoulderR.y - 0.45);

    this._handL.visible = !!handL;
    this._handR.visible = !!handR;
    if (handL) this._handL.position.copy(handL);
    if (handR) this._handR.position.copy(handR);

    this._placeBone(this._bones.armL, shoulderL, restL);
    this._placeBone(this._bones.armR, shoulderR, restR);
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((obj) => obj.geometry?.dispose?.());
    this._mat.dispose();
  }
}
