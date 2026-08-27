import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import * as CFG from "./_avatarConfig.js";
import { solveTwoBone, makeIKScratch } from "./_ik.js";

/**
 * リプレイ時だけ表示する「過去の自分」のアバター（案B）。
 *
 * 記録データ（`ctx.replayer.frame` の head / handLeft / handRight）から:
 *  - ルート（体全体）を頭の真下に置き、頭の向きへ緩やかにヨー追従
 *  - 頭ボーンは記録の頭姿勢をそのまま反映
 *  - 腕は肩ボーン位置を起点に2ボーン解析IK（`_ik.js`）で手先へ伸ばす
 *  - 体・脚は待機アニメ（Idle）で自然な立ち姿勢に保つ（下半身は3点トラッキングでは
 *    取得できないため「推定」。深いしゃがみ等では嘘くさくなる割り切り）
 *  - 身長は記録中の head.y から自動でスケール（`_scanEyeHeight`）
 *
 * すべて presentation 内で完結。core / constants.js は参照のみ・変更なし。
 * モデルは Quaternius「Man」(CC0) を `public/models/avatar.glb` に配置。
 * 調整値は `_avatarConfig.js`。実機（PICO 4 Ultra）で肘ヒント等を詰める前提。
 */
export class PlayerAvatar {
  constructor(scene, ctx) {
    this.scene = scene;
    this._disposed = false;
    this.ready = false;

    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    this._model = null;
    this._bones = {};
    this._mixer = null;

    this._scannedReplayer = null;
    this._scaleFactor = 1;
    this._modelEyeH = CFG.FALLBACK_STATURE * CFG.EYE_TO_STATURE;

    // 腕の寸法・レスト軸（読み込み時に実測）
    this._arm = {
      L: { L1: 0.25, L2: 0.25, axisUpper: new THREE.Vector3(0, 1, 0), axisLower: new THREE.Vector3(0, 1, 0) },
      R: { L1: 0.25, L2: 0.25, axisUpper: new THREE.Vector3(0, 1, 0), axisLower: new THREE.Vector3(0, 1, 0) }
    };

    // 手首の発光球（IKが多少ズレても手の位置が分かる保険＆ホログラム感）
    this._orbs = { L: null, R: null };
    if (CFG.WRIST_ORB) {
      const orbMat = new THREE.MeshBasicMaterial({
        color: CFG.COLOR, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false
      });
      const orbGeo = new THREE.SphereGeometry(CFG.WRIST_ORB_RADIUS, 12, 8);
      for (const s of ["L", "R"]) {
        const orb = new THREE.Mesh(orbGeo, orbMat);
        orb.visible = false;
        orb.renderOrder = CFG.RENDER_ORDER + 1;
        orb.frustumCulled = false;
        this._orbs[s] = orb;
        scene.add(orb);
      }
    }

    // 使い回しスクラッチ
    this._ik = makeIKScratch();
    this._v = new THREE.Vector3();
    this._vT = new THREE.Vector3();
    this._vS = new THREE.Vector3();
    this._vFwd = new THREE.Vector3();
    this._vPole = new THREE.Vector3();
    this._vDirP = new THREE.Vector3();
    this._qHead = new THREE.Quaternion();
    this._qParent = new THREE.Quaternion();
    this._qYaw = new THREE.Quaternion();
    this._qYawDamped = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 1, 0);
    this._qFix = new THREE.Quaternion();
    this._eFix = new THREE.Euler();

    if (!CFG.ENABLED) return;

    new GLTFLoader().load(
      CFG.MODEL_URL,
      (gltf) => this._onLoad(gltf),
      undefined,
      (err) =>
        console.warn(
          `[PlayerAvatar] ${CFG.MODEL_URL} を読み込めません（public/models/ に配置してください）`,
          err
        )
    );
  }

  _onLoad(gltf) {
    if (this._disposed) {
      gltf.scene.traverse((o) => o.geometry?.dispose?.());
      return;
    }

    this._model = gltf.scene;
    this.group.add(this._model);

    // 「過去の自分」のエコー: 半透明・不透明背景を作らない（パススルーMR前提）
    const echoMat = new THREE.MeshBasicMaterial({
      color: CFG.COLOR,
      transparent: true,
      opacity: CFG.OPACITY,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide
    });
    this._echoMat = echoMat;
    this._model.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.material = echoMat;
        o.renderOrder = CFG.RENDER_ORDER;
        o.frustumCulled = false; // ボーンを曲げると事前計算のバウンディングが古くなり消えることがある
      }
    });

    // ボーン解決。GLTFLoader は node 名の予約文字（. : / [ ]）を除去するため
    // "Shoulder.L" は "ShoulderL" になる。素の名前・除去版・_置換版・正規化一致の順で探す。
    const missing = [];
    this._bonesMissing = missing;
    for (const [key, name] of Object.entries(CFG.BONES)) {
      const bone = this._findBone(name);
      if (!bone) missing.push(name);
      this._bones[key] = bone || null;
    }
    if (missing.length) {
      console.warn("[PlayerAvatar] ボーンが見つかりません:", missing.join(", "));
    }

    // バインドポーズで採寸（group はまだ scale=1 / 原点）
    this.group.position.set(0, 0, 0);
    this.group.quaternion.identity();
    this.group.scale.setScalar(1);
    this.group.updateMatrixWorld(true);

    if (this._bones.head) {
      this._modelEyeH = this._bones.head.getWorldPosition(this._v).y;
      if (!(this._modelEyeH > 0.3 && this._modelEyeH < 5)) {
        console.warn("[PlayerAvatar] モデルの目線高が想定外です:", this._modelEyeH);
      }
    }

    for (const s of ["L", "R"]) {
      const up = this._bones["upperArm" + s];
      const lo = this._bones["lowerArm" + s];
      const ha = this._bones["hand" + s];
      const arm = this._arm[s];
      if (up && lo) {
        arm.L1 = up.getWorldPosition(this._vS).distanceTo(lo.getWorldPosition(this._vT)) || arm.L1;
        arm.axisUpper.copy(lo.position).normalize();
      }
      if (lo && ha) {
        arm.L2 = lo.getWorldPosition(this._vS).distanceTo(ha.getWorldPosition(this._vT)) || arm.L2;
        arm.axisLower.copy(ha.position).normalize();
      }
    }

    // 体・脚の待機ポーズ（無ければバインドのまま）
    const clips = gltf.animations || [];
    const idle =
      clips.find((c) => c.name === CFG.IDLE_CLIP) ||
      clips.find((c) => /idle/i.test(c.name)) ||
      null;
    if (idle) {
      this._mixer = new THREE.AnimationMixer(this._model);
      const action = this._mixer.clipAction(idle);
      action.timeScale = CFG.IDLE_TIMESCALE;
      action.play();
    }

    this.ready = true;
  }

  /** GLTFLoader の名前サニタイズ差を吸収してボーンを探す */
  _findBone(name) {
    if (!this._model) return null;
    const candidates = [
      name,
      name.replace(/[.:/[\]]/g, ""), // GLTFLoader (PropertyBinding.sanitizeNodeName) は予約文字を除去
      name.replace(/[.\s]/g, "_") // 一般的な「_ 置換」型のリグ
    ];
    for (const c of candidates) {
      const b = this._model.getObjectByName(c);
      if (b) return b;
    }
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const want = norm(name);
    let found = null;
    this._model.traverse((o) => {
      if (!found && o.name && norm(o.name) === want) found = o;
    });
    return found;
  }

  /** 記録フレーム群から「立ち目線高」を推定（しゃがみに引っ張られないよう分位で取る） */
  _scanEyeHeight(frames) {
    const ys = [];
    for (const f of frames) if (f && f.head) ys.push(f.head.y);
    if (ys.length < 5) return CFG.FALLBACK_STATURE * CFG.EYE_TO_STATURE;
    ys.sort((a, b) => a - b);
    const eyeH = ys[Math.min(ys.length - 1, Math.floor(ys.length * CFG.HEAD_PERCENTILE))];
    if (!Number.isFinite(eyeH) || eyeH < 0.8) return CFG.FALLBACK_STATURE * CFG.EYE_TO_STATURE;
    return eyeH;
  }

  /** ボーンのローカル回転を、指定ワールド方向へ「子へ向かう軸」が向くように設定 */
  _setBoneWorldDir(bone, restAxisLocal, worldDir) {
    if (!bone || !bone.parent) return;
    bone.parent.getWorldQuaternion(this._qParent);
    this._vDirP.copy(worldDir).applyQuaternion(this._qParent.invert());
    bone.quaternion.setFromUnitVectors(restAxisLocal, this._vDirP.normalize());
  }

  update(dt, ctx) {
    if (this._disposed || !CFG.ENABLED) return;

    const active = ctx?.game?.state === "REPLAY";
    const frame = active ? ctx.replayer?.frame : null;

    if (!this.ready || !frame || !frame.head) {
      this.group.visible = false;
      if (this._orbs.L) this._orbs.L.visible = false;
      if (this._orbs.R) this._orbs.R.visible = false;
      return;
    }
    this.group.visible = true;

    // リプレイが差し替わったら身長を測り直す。
    // プレイヤーの目線高を人間の範囲に丸め、モデルの素の目線高に合わせて等倍スケール
    // （モデルが人間離れしたサイズでも吸収する）。
    if (ctx.replayer && ctx.replayer !== this._scannedReplayer) {
      this._scannedReplayer = ctx.replayer;
      const eyeH = this._scanEyeHeight(ctx.replayer.frames || []);
      const wantEyeH = THREE.MathUtils.clamp(
        eyeH,
        CFG.EYE_HEIGHT_CLAMP[0],
        CFG.EYE_HEIGHT_CLAMP[1]
      );
      const m = this._modelEyeH;
      this._scaleFactor = m > 0.01 && Number.isFinite(m) ? wantEyeH / m : 1;
      this.group.scale.setScalar(this._scaleFactor);
      if (this._mixer) this._mixer.setTime(0);
    }

    // 1) 体・脚を待機ポーズへ（この後の頭・腕の上書きより先に）
    if (this._mixer) this._mixer.update(dt);

    // 2) ルートの位置（頭の真下・足を床に）と向き（頭のヨーへ追従）
    const h = frame.head;
    this.group.position.x = THREE.MathUtils.damp(this.group.position.x, h.x, CFG.POS_DAMP, dt);
    this.group.position.z = THREE.MathUtils.damp(this.group.position.z, h.z, CFG.POS_DAMP, dt);

    this._qHead.set(h.qx, h.qy, h.qz, h.qw);
    this._vFwd.set(0, 0, -1).applyQuaternion(this._qHead);
    const yaw = Math.atan2(this._vFwd.x, -this._vFwd.z) + CFG.MODEL_FACE_YAW_OFFSET;
    this._qYaw.setFromAxisAngle(this._up, yaw);
    // 減衰 → さらに角速度制限（急な首振りで体がスピンしない）
    this._qYawDamped.copy(this.group.quaternion).slerp(this._qYaw, 1 - Math.exp(-CFG.YAW_DAMP * dt));
    this.group.quaternion.rotateTowards(this._qYawDamped, CFG.YAW_MAX_RATE * dt);

    this.group.updateMatrixWorld(true);

    // 3) 記録の頭の高さに正確に合わせる（モデル原点・足位置のズレを吸収）
    if (this._bones.head) {
      const dy = h.y - this._bones.head.getWorldPosition(this._v).y;
      this.group.position.y += dy;
      this.group.updateMatrixWorld(true);
    }

    // 4) 頭の向きを記録どおりに（HEAD_FIX_EULER でレスト姿勢差を補正）
    if (this._bones.head && this._bones.head.parent) {
      this._qFix.setFromEuler(
        this._eFix.set(CFG.HEAD_FIX_EULER.x, CFG.HEAD_FIX_EULER.y, CFG.HEAD_FIX_EULER.z)
      );
      this._bones.head.parent.getWorldQuaternion(this._qParent);
      this._bones.head.quaternion
        .copy(this._qParent.invert())
        .multiply(this._qHead)
        .multiply(this._qFix);
      this._bones.head.updateMatrixWorld(true);
    }

    // 5) 腕の2ボーンIK
    if (CFG.ARM_IK) {
      this._solveArm("L", frame.handLeft, CFG.ELBOW_HINT_L);
      this._solveArm("R", frame.handRight, CFG.ELBOW_HINT_R);
    }
  }

  _solveArm(side, handPose, hintLocal) {
    const orb = this._orbs[side];
    const up = this._bones["upperArm" + side];
    const lo = this._bones["lowerArm" + side];
    if (!handPose || !up || !lo) {
      if (orb) orb.visible = false;
      return; // 手の記録が無い側は待機ポーズのまま
    }

    this._vT.set(handPose.x, handPose.y, handPose.z); // 目標（手先ワールド）
    up.getWorldPosition(this._vS); // 肩（上腕付け根ワールド）

    // 肘ヒントをアバターの向きに合わせて回す（下・外・後ろ）
    this._vPole.set(hintLocal.x, hintLocal.y, hintLocal.z).applyQuaternion(this.group.quaternion).normalize();

    const arm = this._arm[side];
    solveTwoBone(
      this._vS,
      this._vT,
      arm.L1 * this._scaleFactor,
      arm.L2 * this._scaleFactor,
      this._vPole,
      this._ik
    );

    this._setBoneWorldDir(up, arm.axisUpper, this._ik.dirUpper);
    up.updateMatrixWorld(true);
    this._setBoneWorldDir(lo, arm.axisLower, this._ik.dirLower);
    lo.updateMatrixWorld(true);

    if (CFG.HAND_ORIENT) {
      const ha = this._bones["hand" + side];
      if (ha && ha.parent && handPose.qx != null) {
        this._qHead.set(handPose.qx, handPose.qy, handPose.qz, handPose.qw);
        ha.parent.getWorldQuaternion(this._qParent);
        ha.quaternion.copy(this._qParent.invert()).multiply(this._qHead);
      }
    }

    if (orb) {
      orb.visible = true;
      orb.position.copy(this._vT);
    }
  }

  dispose() {
    this._disposed = true;
    if (this._mixer) this._mixer.stopAllAction();
    this.scene.remove(this.group);

    for (const s of ["L", "R"]) {
      const orb = this._orbs[s];
      if (orb) {
        this.scene.remove(orb);
        orb.geometry?.dispose?.();
        orb.material?.dispose?.();
      }
    }

    this.group.traverse((o) => {
      o.geometry?.dispose?.();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x?.dispose?.());
      else m?.dispose?.();
    });
  }
}
