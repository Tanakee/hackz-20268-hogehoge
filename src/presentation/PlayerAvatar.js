import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const MODEL_URL = `${import.meta.env.BASE_URL}models/avatar.glb`;
const TARGET_HEIGHT = 1.7; // m。モデルの実寸がバラバラでも身長がこの値になるよう自動スケールする
const ARM_REST_DROP = 0.35; // m。手のトラッキングがnullのとき、肩からこの分だけ下に手を下ろす

// glTFファイル上のボーン名は "Shoulder.L" のようにドット区切りだが、
// GLTFLoaderの読み込み時にドットがサニタイズされ "ShoulderL" になる（実機確認済み）。
const ARM_BONES = {
  left: { shoulder: "ShoulderL", upper: "UpperArmL", lower: "LowerArmL", palm: "PalmL" },
  right: { shoulder: "ShoulderR", upper: "UpperArmR", lower: "LowerArmR", palm: "PalmR" }
};

const ONE = new THREE.Vector3(1, 1, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

// モデルのHeadボーンの「顔の前方向」が、WebXRトラッキング姿勢が想定する前方向
// （ローカル-Z）と180度反転していた（実機確認：体ごと後ろ向きになる）ため補正する。
const HEAD_FORWARD_FIX = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, Math.PI);

/**
 * リプレイ時だけ表示する人型アバター（Quaternius製glTFモデル、ユーザー提供）。
 * 記録データ（ctx.replayer.frame.head / handLeft / handRight）から、
 * 頭にモデル全体を追従させ、両腕はTwo-Bone IKで手の位置・向きに合わせる。
 * 脚はバインドポーズ固定（GAMESPEC 6.2：足のトラッキングは行わない）。
 */
export class PlayerAvatar {
  constructor(scene, ctx) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    this._ready = false;
    this._bones = {};
    this._arms = {}; // left/right -> { upperLen, lowerLen, upperAxis, lowerAxis }

    // 作業用の一時オブジェクト（毎フレームのnewを避ける）
    this._headPos = new THREE.Vector3();
    this._headQuat = new THREE.Quaternion();
    this._targetMatrix = new THREE.Matrix4();
    this._groupMatrix = new THREE.Matrix4();
    this._throwawayScale = new THREE.Vector3();
    this._handPos = new THREE.Vector3();
    this._handQuat = new THREE.Quaternion();
    this._shoulderPos = new THREE.Vector3();
    this._elbowPos = new THREE.Vector3();
    this._toTarget = new THREE.Vector3();
    this._bendDir = new THREE.Vector3();
    this._poleVec = new THREE.Vector3();
    this._forwardWorld = new THREE.Vector3();
    this._tmpQuat = new THREE.Quaternion();
    this._tmpQuat2 = new THREE.Quaternion();
    this._tmpVecA = new THREE.Vector3();
    this._tmpVecB = new THREE.Vector3();
    this._euler = new THREE.Euler();
    this._bodyYawQuat = new THREE.Quaternion();
    this._fullHeadQuat = new THREE.Quaternion();
    this._restTarget = new THREE.Vector3();

    const loader = new GLTFLoader();
    loader.load(
      MODEL_URL,
      (gltf) => this._onLoaded(gltf),
      undefined,
      (err) => console.warn(`[PlayerAvatar] ${MODEL_URL} の読み込みに失敗しました`, err)
    );
  }

  _onLoaded(gltf) {
    const model = gltf.scene;

    // モデルごとの実寸バラつきを吸収するため、身長がTARGET_HEIGHTになるよう自動スケール。
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    if (size.y > 0) {
      model.scale.setScalar(TARGET_HEIGHT / size.y);
    }

    this.group.add(model);

    const boneNames = ["Head", "Neck", ...Object.values(ARM_BONES).flatMap((b) => Object.values(b))];
    model.traverse((obj) => {
      if (boneNames.includes(obj.name)) {
        this._bones[obj.name] = obj;
      }
    });

    const missing = boneNames.filter((n) => !this._bones[n]);
    if (missing.length > 0) {
      console.warn(`[PlayerAvatar] モデルにボーンが見つかりません: ${missing.join(", ")}`);
      return;
    }

    // groupがidentity transformの今のうちに、バインドポーズの情報を確定させる。
    this.group.updateWorldMatrix(true, true);

    // 頭: groupを動かしてHeadボーンのワールド行列をトラッキングデータに一致させるための逆行列。
    // Head.matrixWorldにはmodelの自動スケール（TARGET_HEIGHT正規化）が乗っているため、
    // そのまま逆行列を取ってgroupに適用すると、そのスケールがgroup側で打ち消されてしまい、
    // モデル全体が正規化前の実寸（例：身長4m超）に戻ってしまう。
    // スケール成分を取り除いた「回転＋位置のみの剛体変換」で逆行列を作ることで、
    // modelの自動スケールをそのまま保ったまま頭の位置・向きだけを合わせられるようにする。
    const bindPos = new THREE.Vector3();
    const bindQuat = new THREE.Quaternion();
    const bindScale = new THREE.Vector3();
    this._bones.Head.matrixWorld.decompose(bindPos, bindQuat, bindScale);
    const rigidBindMatrix = new THREE.Matrix4().compose(bindPos, bindQuat, ONE);
    this._headBindInverse = new THREE.Matrix4().copy(rigidBindMatrix).invert();

    // 両腕: ボーン長とローカル軸（＝バインドポーズでの「次のジョイントへの方向」をこのボーン自身の
    // ローカル座標系で表したもの）を一度だけ計算しておく。
    for (const side of ["left", "right"]) {
      const names = ARM_BONES[side];
      const shoulder = this._bones[names.shoulder];
      const upper = this._bones[names.upper];
      const lower = this._bones[names.lower];
      const palm = this._bones[names.palm];

      const upperPos = upper.getWorldPosition(new THREE.Vector3());
      const lowerPos = lower.getWorldPosition(new THREE.Vector3());
      const palmPos = palm.getWorldPosition(new THREE.Vector3());

      this._arms[side] = {
        shoulder,
        upper,
        lower,
        palm,
        upperLen: upperPos.distanceTo(lowerPos),
        lowerLen: lowerPos.distanceTo(palmPos),
        upperAxis: this._localAxis(upper, upperPos, lowerPos),
        lowerAxis: this._localAxis(lower, lowerPos, palmPos)
      };
    }

    this._ready = true;
  }

  /** ボーン自身のローカル座標系で見た「fromWorld→toWorldの方向」（バインドポーズ時、一度だけ計算） */
  _localAxis(bone, fromWorld, toWorld) {
    const dirWorld = new THREE.Vector3().subVectors(toWorld, fromWorld).normalize();
    const boneWorldQuatInv = bone.getWorldQuaternion(new THREE.Quaternion()).invert();
    return dirWorld.applyQuaternion(boneWorldQuatInv).normalize();
  }

  _toVec(p, out) {
    return p ? out.set(p.x, p.y, p.z) : null;
  }

  _toQuat(p, out) {
    return p && p.qx != null ? out.set(p.qx, p.qy, p.qz, p.qw) : null;
  }

  /**
   * 肩→ターゲットの2ボーンIK。UpperArm/LowerArmのローカル回転を直接設定する。
   * poleTarget方向へ肘が曲がるように解く（余弦定理ベースの標準的な2ボーンIK）。
   */
  _solveArm(arm, target) {
    const shoulderPos = arm.shoulder.getWorldPosition(this._shoulderPos);

    this._toTarget.subVectors(target, shoulderPos);
    let dist = this._toTarget.length();
    const maxLen = arm.upperLen + arm.lowerLen - 1e-4;
    const minLen = Math.abs(arm.upperLen - arm.lowerLen) + 1e-4;
    dist = THREE.MathUtils.clamp(dist, minLen, maxLen);
    const axis = this._toTarget.normalize(); // 肩→ターゲット方向（正規化済み）

    // pole方向：体の前方かつやや下（腕は基本的に体の前で曲がる、という近似。要実機調整）
    this._poleVec.copy(this._forwardWorld).multiplyScalar(0.6);
    this._poleVec.y -= 0.5;
    this._poleVec.addScaledVector(axis, -this._poleVec.dot(axis)); // axis成分を除去
    if (this._poleVec.lengthSq() < 1e-6) this._poleVec.set(1, -0.3, 0.3);
    this._poleVec.normalize();
    this._bendDir.copy(this._poleVec);

    // 余弦定理で肩からの投影距離aと、軸から肘までの垂直距離hを求める
    const a = (arm.upperLen * arm.upperLen - arm.lowerLen * arm.lowerLen + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, arm.upperLen * arm.upperLen - a * a));

    this._elbowPos.copy(shoulderPos).addScaledVector(axis, a).addScaledVector(this._bendDir, h);

    const upperWorldDir = this._tmpVecA.subVectors(this._elbowPos, shoulderPos).normalize();
    const lowerWorldDir = this._tmpVecB.subVectors(target, this._elbowPos).normalize();

    this._applyBoneDirection(arm.upper, arm.upperAxis, upperWorldDir);
    this._applyBoneDirection(arm.lower, arm.lowerAxis, lowerWorldDir);

    return this._elbowPos;
  }

  /** ボーンのローカル軸(axisLocal)が、指定したワールド方向(dirWorld)を向くようローカル回転を設定する */
  _applyBoneDirection(bone, axisLocal, dirWorld) {
    const parentWorldQuat = bone.parent.getWorldQuaternion(this._tmpQuat);
    this._tmpQuat2.setFromUnitVectors(axisLocal, dirWorld);
    bone.quaternion.copy(parentWorldQuat.invert().multiply(this._tmpQuat2));
  }

  update(_dt, ctx) {
    if (!this._ready) return;

    const active = ctx.game?.state === "REPLAY";
    const frame = ctx.replayer?.frame;
    const head = active && frame ? this._toVec(frame.head, this._headPos) : null;

    if (!head) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;

    // 体幹（group）はヨー（左右の向き）だけに追従させ、頭の完全な回転（見上げる/
    // 見下ろす/首をかしげる）はHeadボーン自身にだけ反映する。頭の全回転を体ごとに
    // 反映すると、見上げただけで体ごと傾く不自然な動きになってしまうため。
    const headQuat = this._toQuat(frame.head, this._headQuat) ?? this._headQuat.identity();

    // 腕IKのpole方向（体の前方）は、HEAD_FORWARD_FIX適用前の生のトラッキング姿勢
    // （WebXR標準で-Zが視線前方）から計算する。
    this._forwardWorld.set(0, 0, -1).applyQuaternion(headQuat);

    this._euler.setFromQuaternion(headQuat, "YXZ");
    this._bodyYawQuat.setFromAxisAngle(Y_AXIS, this._euler.y).multiply(HEAD_FORWARD_FIX);

    // Step1: groupを「Headの位置=headPos、Headの回転=ヨーのみ」になるよう逆算する。
    // Spineチェーン（Hips〜Head）はバインドポーズのまま固定し、groupごと動かす。
    this._targetMatrix.compose(head, this._bodyYawQuat, ONE);
    this._groupMatrix.multiplyMatrices(this._targetMatrix, this._headBindInverse);
    this._groupMatrix.decompose(this.group.position, this.group.quaternion, this._throwawayScale);
    this.group.updateWorldMatrix(true, true);

    // Step2: Headボーンのローカル回転を上書きし、頭だけ実際の完全な回転に一致させる。
    // Headの位置はStep1の時点で既にheadPosに一致しており、回転のみの変更なので崩れない。
    this._fullHeadQuat.copy(headQuat).multiply(HEAD_FORWARD_FIX);
    const neckWorldQuat = this._bones.Neck.getWorldQuaternion(this._tmpQuat);
    this._bones.Head.quaternion.copy(neckWorldQuat.invert().multiply(this._fullHeadQuat));

    for (const side of ["left", "right"]) {
      const arm = this._arms[side];
      const rawHand = side === "left" ? frame.handLeft : frame.handRight;
      const hand = this._toVec(rawHand, this._handPos);

      let target;
      if (hand) {
        target = hand;
      } else {
        // 未トラッキング時は肩の下に自然に手を下げる。
        // _tmpVecA/_tmpVecBは_solveArm内部で書き換えられるため、targetには専用の変数を使う。
        target = arm.shoulder.getWorldPosition(this._restTarget);
        target.y -= ARM_REST_DROP;
      }

      this._solveArm(arm, target);

      const handQuat = hand ? this._toQuat(rawHand, this._handQuat) : null;
      if (handQuat) {
        const lowerWorldQuat = arm.lower.getWorldQuaternion(this._tmpQuat);
        arm.palm.quaternion.copy(lowerWorldQuat.invert().multiply(handQuat));
      }
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((obj) => {
      obj.geometry?.dispose?.();
      const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
      mats.forEach((m) => m.dispose?.());
    });
  }
}
