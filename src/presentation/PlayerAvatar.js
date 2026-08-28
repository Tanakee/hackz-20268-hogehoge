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

// 脚（PICO Motion Tracker連携時のみ動く。トラッカー未接続時はバインドポーズ固定）。
// 左右とも根本のボーンはHips（共有）。
const LEG_BONES = {
  left: { hip: "Hips", upper: "UpperLegL", lower: "LowerLegL", foot: "FootL" },
  right: { hip: "Hips", upper: "UpperLegR", lower: "LowerLegR", foot: "FootR" }
};

const ONE = new THREE.Vector3(1, 1, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

// モデルのHeadボーンの「顔の前方向」が、WebXRトラッキング姿勢が想定する前方向
// （ローカル-Z）と180度反転していた（実機確認：体ごと後ろ向きになる）ため補正する。
const HEAD_FORWARD_FIX = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, Math.PI);

// コントローラーのgrip姿勢の軸（-Z:前方 / Y:上）とPalmボーンのバインド軸の基準が
// 一致していないため、そのまま割り当てると手のひらが不自然な向き（前方を向く等）に
// なる（実機確認）。ローカルX軸で-90度回し、下向きに補正する第一候補。
// 実機で見た目が変わるので、まだ不自然な場合は角度・軸を再調整すること。
const HAND_ROTATION_FIX = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

/**
 * リプレイ時だけ表示する人型アバター（Quaternius製glTFモデル、ユーザー提供）。
 * 記録データ（ctx.replayer.frame.head / handLeft / handRight）から、
 * 頭にモデル全体を追従させ、両腕はTwo-Bone IKで手の位置・向きに合わせる。
 * 脚は、PICO Motion Tracker連携（frame.legs、MotionTrackerBridge経由で記録された
 * 場合のみ）があればTwo-Bone IKで動かす。連携がなければ従来通りバインドポーズ固定
 * （GAMESPEC 6.2）。
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
    this._legs = {}; // left/right -> { upperLen, lowerLen, upperAxis, lowerAxis }（Hip共有）

    // 作業用の一時オブジェクト（毎フレームのnewを避ける）
    this._headPos = new THREE.Vector3();
    this._headQuat = new THREE.Quaternion();
    this._targetMatrix = new THREE.Matrix4();
    this._groupMatrix = new THREE.Matrix4();
    this._throwawayScale = new THREE.Vector3();
    this._handPos = new THREE.Vector3();
    this._handQuat = new THREE.Quaternion();
    this._rootPos = new THREE.Vector3();
    this._ikTarget = new THREE.Vector3();
    this._jointPos = new THREE.Vector3();
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
    this._legAnkleTarget = new THREE.Vector3();
    this._legKneeHint = new THREE.Vector3();
    this._legRootPos = new THREE.Vector3();
    this._legYawQuat = new THREE.Quaternion();

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

    // 脚のボーンは無くても（腕・頭が動く）本体機能に影響させたくないので、
    // 必須ボーン一覧とは別に集める（missingでも早期returnしない）。
    const legBoneNames = [...Object.values(LEG_BONES).flatMap((b) => Object.values(b))];
    const boneNames = [
      "Head",
      "Neck",
      ...Object.values(ARM_BONES).flatMap((b) => Object.values(b)),
      ...legBoneNames
    ];
    model.traverse((obj) => {
      if (boneNames.includes(obj.name)) {
        this._bones[obj.name] = obj;
      }
    });

    const requiredBoneNames = ["Head", "Neck", ...Object.values(ARM_BONES).flatMap((b) => Object.values(b))];
    const missing = requiredBoneNames.filter((n) => !this._bones[n]);
    if (missing.length > 0) {
      console.warn(`[PlayerAvatar] モデルにボーンが見つかりません: ${missing.join(", ")}`);
      return;
    }
    const missingLegBones = legBoneNames.filter((n) => !this._bones[n]);
    if (missingLegBones.length > 0) {
      console.warn(
        `[PlayerAvatar] 脚のボーンが見つかりません（脚IKは無効化されます）: ${missingLegBones.join(", ")}`
      );
    }
    this._legsAvailable = missingLegBones.length === 0;

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
        root: shoulder,
        upper,
        lower,
        palm,
        upperLen: upperPos.distanceTo(lowerPos),
        lowerLen: lowerPos.distanceTo(palmPos),
        upperAxis: this._localAxis(upper, upperPos, lowerPos),
        lowerAxis: this._localAxis(lower, lowerPos, palmPos)
      };
    }

    // 両脚: 腕と同様。脚のボーンが揃っている場合のみ（_legsAvailable）。
    if (this._legsAvailable) {
      for (const side of ["left", "right"]) {
        const names = LEG_BONES[side];
        const hip = this._bones[names.hip];
        const upper = this._bones[names.upper];
        const lower = this._bones[names.lower];
        const foot = this._bones[names.foot];

        const upperPos = upper.getWorldPosition(new THREE.Vector3());
        const lowerPos = lower.getWorldPosition(new THREE.Vector3());
        const footPos = foot.getWorldPosition(new THREE.Vector3());

        this._legs[side] = {
          root: hip,
          upper,
          lower,
          upperLen: upperPos.distanceTo(lowerPos),
          lowerLen: lowerPos.distanceTo(footPos),
          upperAxis: this._localAxis(upper, upperPos, lowerPos),
          lowerAxis: this._localAxis(lower, lowerPos, footPos)
        };
      }
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
   * root→ターゲットの2ボーンIK（腕・脚共通）。upper/lowerのローカル回転を直接設定する。
   * bendDir方向へ中間関節（肘/膝）が曲がるように解く（余弦定理ベースの標準的な2ボーンIK）。
   * bendDirは正規化済みで、axis（root→target方向）の成分は呼び出し側で除去しておくこと。
   */
  _solveTwoBoneIK(limb, rootPos, target, axis, dist, bendDir) {
    // 余弦定理でrootからの投影距離aと、軸から中間関節までの垂直距離hを求める
    const a = (limb.upperLen * limb.upperLen - limb.lowerLen * limb.lowerLen + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, limb.upperLen * limb.upperLen - a * a));

    this._jointPos.copy(rootPos).addScaledVector(axis, a).addScaledVector(bendDir, h);

    const upperWorldDir = this._tmpVecA.subVectors(this._jointPos, rootPos).normalize();
    const lowerWorldDir = this._tmpVecB.subVectors(target, this._jointPos).normalize();

    this._applyBoneDirection(limb.upper, limb.upperAxis, upperWorldDir);
    this._applyBoneDirection(limb.lower, limb.lowerAxis, lowerWorldDir);

    return this._jointPos;
  }

  /** rootPos→targetの軸・クランプ済み距離を求める共通処理。axisOutに正規化済み方向を書き込み、距離を返す。 */
  _axisAndClampedDist(limb, rootPos, target, axisOut) {
    axisOut.subVectors(target, rootPos);
    let dist = axisOut.length();
    const maxLen = limb.upperLen + limb.lowerLen - 1e-4;
    const minLen = Math.abs(limb.upperLen - limb.lowerLen) + 1e-4;
    dist = THREE.MathUtils.clamp(dist, minLen, maxLen);
    axisOut.normalize();
    return dist;
  }

  /** 肩→ターゲット。pole方向は体の前方かつやや下（腕は基本的に体の前で曲がる、という近似）。 */
  _solveArm(arm, target) {
    const rootPos = arm.root.getWorldPosition(this._rootPos);
    const dist = this._axisAndClampedDist(arm, rootPos, target, this._toTarget);
    const axis = this._toTarget;

    this._poleVec.copy(this._forwardWorld).multiplyScalar(0.6);
    this._poleVec.y -= 0.5;
    this._poleVec.addScaledVector(axis, -this._poleVec.dot(axis)); // axis成分を除去
    if (this._poleVec.lengthSq() < 1e-6) this._poleVec.set(1, -0.3, 0.3);
    this._poleVec.normalize();

    return this._solveTwoBoneIK(arm, rootPos, target, axis, dist, this._poleVec);
  }

  /**
   * 腰→ターゲット。pole方向（膝の曲がる向き）はkneeHint（トラッカーの膝相対位置、
   * ワールド座標）があればそれを使い、無ければ「体の前方かつやや下」の近似にフォールバックする。
   */
  _solveLeg(leg, target, kneeHint) {
    const rootPos = leg.root.getWorldPosition(this._rootPos);
    const dist = this._axisAndClampedDist(leg, rootPos, target, this._toTarget);
    const axis = this._toTarget;

    if (kneeHint) {
      this._poleVec.subVectors(kneeHint, rootPos);
    } else {
      this._poleVec.copy(this._forwardWorld).multiplyScalar(0.5);
      this._poleVec.y -= 0.5;
    }
    this._poleVec.addScaledVector(axis, -this._poleVec.dot(axis)); // axis成分を除去
    if (this._poleVec.lengthSq() < 1e-6) this._poleVec.set(0, -0.3, 1);
    this._poleVec.normalize();

    return this._solveTwoBoneIK(leg, rootPos, target, axis, dist, this._poleVec);
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
        target = arm.root.getWorldPosition(this._restTarget);
        target.y -= ARM_REST_DROP;
      }

      this._solveArm(arm, target);

      const handQuat = hand ? this._toQuat(rawHand, this._handQuat) : null;
      if (handQuat) {
        handQuat.multiply(HAND_ROTATION_FIX);
        const lowerWorldQuat = arm.lower.getWorldQuaternion(this._tmpQuat);
        arm.palm.quaternion.copy(lowerWorldQuat.invert().multiply(handQuat));
      }
    }

    // 脚：PICO Motion Tracker連携（frame.legs、MotionTrackerBridge経由で記録されている
    // 場合のみ）で動かす。連携がなければバインドポーズのまま（GAMESPEC 6.2）。
    if (this._legsAvailable && frame.legs) {
      // トラッカーのデータは「腰(Hips)からの相対オフセット、体の正面基準のローカル座標」
      // （x:右 / y:上 / z:後方、-zが前方＝WebXRの頭・手の姿勢と同じ規約）で送られてくる
      // 想定。Unity側とWebXR側で絶対座標系の原点が一致する保証がないため、絶対位置ではなく
      // 頭のヨー（_euler.y、HEAD_FORWARD_FIXを含まない生の値）だけを使ってワールド座標に変換する。
      this._legYawQuat.setFromAxisAngle(Y_AXIS, this._euler.y);

      for (const side of ["left", "right"]) {
        const leg = this._legs[side];
        const legData = side === "left" ? frame.legs.left : frame.legs.right;
        if (!legData?.ankle) continue;

        const rootPos = leg.root.getWorldPosition(this._legRootPos);
        this._legAnkleTarget
          .set(legData.ankle.x, legData.ankle.y, legData.ankle.z)
          .applyQuaternion(this._legYawQuat)
          .add(rootPos);

        let kneeHint = null;
        if (legData.knee) {
          this._legKneeHint
            .set(legData.knee.x, legData.knee.y, legData.knee.z)
            .applyQuaternion(this._legYawQuat)
            .add(rootPos);
          kneeHint = this._legKneeHint;
        }

        this._solveLeg(leg, this._legAnkleTarget, kneeHint);
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
