import fs from "node:fs";
import * as THREE from "three";

// --- avatar.glbから実際のローカルtranslationを取り出す ---
const buf = fs.readFileSync("/Users/tanakee/Documents/development/hackathon/hackz-20268-hogehoge/public/models/avatar.glb");
const jsonChunkLength = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.slice(20, 20 + jsonChunkLength).toString("utf8"));
const nodes = gltf.nodes;
const byName = {};
nodes.forEach((n, i) => { if (n.name) byName[n.name] = i; });

function makeObject3D(name) {
  const n = nodes[byName[name]];
  const o = new THREE.Object3D();
  o.name = name.replace(/\./g, ""); // GLTFLoaderのドット除去を再現
  if (n.translation) o.position.set(...n.translation);
  if (n.rotation) o.quaternion.set(...n.rotation);
  if (n.scale) o.scale.set(...n.scale);
  return o;
}

// --- 実際の階層を再現（Group > ... > Hips > UpperLeg.L > LowerLeg.L、Foot.Lは別枝）---
const group = new THREE.Group(); // PlayerAvatar.group相当
const rootNode = makeObject3D("RootNode");
const armature = makeObject3D("HumanArmature");
const boneRoot = makeObject3D("Bone");
const body = makeObject3D("Body");
const hips = makeObject3D("Hips");
const upperLegL = makeObject3D("UpperLeg.L");
const lowerLegL = makeObject3D("LowerLeg.L");
const footL = makeObject3D("Foot.L"); // Boneの直下（Hips系列とは別枝、実際の階層通り）

group.add(rootNode);
rootNode.add(armature);
armature.add(boneRoot);
boneRoot.add(body);
body.add(hips);
hips.add(upperLegL);
upperLegL.add(lowerLegL);
boneRoot.add(footL); // 実際の階層：LowerLeg.Lの子ではなくBoneの子

group.updateWorldMatrix(true, true);

// --- PlayerAvatar._onLoadedの脚セットアップを再現 ---
function localAxis(bone, fromWorld, toWorld) {
  const dirWorld = new THREE.Vector3().subVectors(toWorld, fromWorld).normalize();
  const boneWorldQuatInv = bone.getWorldQuaternion(new THREE.Quaternion()).invert();
  return dirWorld.applyQuaternion(boneWorldQuatInv).normalize();
}

const upperPos = upperLegL.getWorldPosition(new THREE.Vector3());
const lowerPos = lowerLegL.getWorldPosition(new THREE.Vector3());
const footPos = footL.getWorldPosition(new THREE.Vector3());

const leg = {
  root: hips,
  upper: upperLegL,
  lower: lowerLegL,
  upperLen: upperPos.distanceTo(lowerPos),
  lowerLen: lowerPos.distanceTo(footPos),
  upperAxis: localAxis(upperLegL, upperPos, lowerPos),
  lowerAxis: localAxis(lowerLegL, lowerPos, footPos)
};

console.log("upperLen:", leg.upperLen.toFixed(4), "lowerLen:", leg.lowerLen.toFixed(4));
console.log("upperAxis (local):", leg.upperAxis.toArray().map(v => v.toFixed(3)));
console.log("lowerAxis (local):", leg.lowerAxis.toArray().map(v => v.toFixed(3)));
console.log("bind upperLeg quat (identity?):", upperLegL.quaternion.toArray().map(v => v.toFixed(4)));
console.log("bind lowerLeg quat (identity?):", lowerLegL.quaternion.toArray().map(v => v.toFixed(4)));

// --- PlayerAvatar._solveTwoBoneIK / _solveLeg を再現 ---
function applyBoneDirection(bone, axisLocal, dirWorld) {
  const parentWorldQuat = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  const q = new THREE.Quaternion().setFromUnitVectors(axisLocal, dirWorld);
  bone.quaternion.copy(parentWorldQuat.invert().multiply(q));
}

function solveTwoBoneIK(limb, rootPos, target, axis, dist, bendDir) {
  const a = (limb.upperLen * limb.upperLen - limb.lowerLen * limb.lowerLen + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, limb.upperLen * limb.upperLen - a * a));
  const jointPos = new THREE.Vector3().copy(rootPos).addScaledVector(axis, a).addScaledVector(bendDir, h);
  const upperWorldDir = new THREE.Vector3().subVectors(jointPos, rootPos).normalize();
  const lowerWorldDir = new THREE.Vector3().subVectors(target, jointPos).normalize();
  applyBoneDirection(limb.upper, limb.upperAxis, upperWorldDir);
  applyBoneDirection(limb.lower, limb.lowerAxis, lowerWorldDir);
  return jointPos;
}

function axisAndClampedDist(limb, rootPos, target, axisOut) {
  axisOut.subVectors(target, rootPos);
  let dist = axisOut.length();
  const maxLen = limb.upperLen + limb.lowerLen - 1e-4;
  const minLen = Math.abs(limb.upperLen - limb.lowerLen) + 1e-4;
  dist = THREE.MathUtils.clamp(dist, minLen, maxLen);
  axisOut.normalize();
  return dist;
}

function solveLeg(leg, target, kneeHint) {
  const rootPos = leg.root.getWorldPosition(new THREE.Vector3());
  const toTarget = new THREE.Vector3();
  const dist = axisAndClampedDist(leg, rootPos, target, toTarget);
  const axis = toTarget;
  const poleVec = new THREE.Vector3();
  if (kneeHint) {
    poleVec.subVectors(kneeHint, rootPos);
  } else {
    poleVec.set(0, 0, -1).multiplyScalar(0.5); // forwardWorld近似（正面向き想定）
    poleVec.y -= 0.5;
  }
  poleVec.addScaledVector(axis, -poleVec.dot(axis));
  if (poleVec.lengthSq() < 1e-6) poleVec.set(0, -0.3, 1);
  poleVec.normalize();
  return solveTwoBoneIK(leg, rootPos, target, axis, dist, poleVec);
}

// --- しゃがみをシミュレート：groupを下げてHipsのワールド位置を下げる ---
const TARGET_HEIGHT = 1.7;
const size_head_y = 4.2231; // 既知のHead.y(raw)
const scale = TARGET_HEIGHT / size_head_y; // モデル読み込み時と同じ自動スケール想定（簡易）
group.scale.setScalar(scale);
group.updateWorldMatrix(true, true);

const hipsWorldStanding = hips.getWorldPosition(new THREE.Vector3());
console.log("\nHips world (standing, scale適用後):", hipsWorldStanding.toArray().map(v => v.toFixed(4)));

const REST_LEG_DROP = TARGET_HEIGHT * 0.47;
const restHipY = hipsWorldStanding.y;
const ankleY = restHipY - REST_LEG_DROP;
console.log("restHipY:", restHipY.toFixed(4), "REST_LEG_DROP:", REST_LEG_DROP.toFixed(4), "ankleY (fixed target height):", ankleY.toFixed(4));

// 直立時のターゲット（しゃがみなし）
const standTarget = new THREE.Vector3(hipsWorldStanding.x + 0.11, ankleY, hipsWorldStanding.z);
solveLeg(leg, standTarget, null);
console.log("\n--- 直立時 ---");
console.log("upperLeg quat:", upperLegL.quaternion.toArray().map(v => v.toFixed(4)));
console.log("lowerLeg quat:", lowerLegL.quaternion.toArray().map(v => v.toFixed(4)));
const upperAngleStand = 2 * Math.acos(THREE.MathUtils.clamp(upperLegL.quaternion.w, -1, 1)) * 180 / Math.PI;
console.log("upperLeg回転角(度):", upperAngleStand.toFixed(2));

// group全体を0.3mしゃがませる（headが0.3m下がった状況を模す）
group.position.y -= 0.3;
group.updateWorldMatrix(true, true);
const hipsWorldCrouch = hips.getWorldPosition(new THREE.Vector3());
console.log("\nHips world (0.3mしゃがみ後):", hipsWorldCrouch.toArray().map(v => v.toFixed(4)));

// restHipYは「直近の最大値」なので、しゃがんでも更新されない（standingの値のまま）→ ankleYは変わらない
const crouchTarget = new THREE.Vector3(hipsWorldCrouch.x + 0.11, ankleY, hipsWorldCrouch.z);
solveLeg(leg, crouchTarget, null);
console.log("\n--- しゃがみ時（腰は下がったがankleYは固定） ---");
console.log("upperLeg quat:", upperLegL.quaternion.toArray().map(v => v.toFixed(4)));
console.log("lowerLeg quat:", lowerLegL.quaternion.toArray().map(v => v.toFixed(4)));
const upperAngleCrouch = 2 * Math.acos(THREE.MathUtils.clamp(upperLegL.quaternion.w, -1, 1)) * 180 / Math.PI;
console.log("upperLeg回転角(度):", upperAngleCrouch.toFixed(2));

console.log("\n=== 差分 ===");
console.log("直立時の回転角:", upperAngleStand.toFixed(2), "度");
console.log("しゃがみ時の回転角:", upperAngleCrouch.toFixed(2), "度");
console.log("dist(hip→target) 直立:", hipsWorldStanding.distanceTo(standTarget).toFixed(4));
console.log("dist(hip→target) しゃがみ:", hipsWorldCrouch.distanceTo(crouchTarget).toFixed(4));
console.log("leg reach (upper+lower):", (leg.upperLen + leg.lowerLen).toFixed(4));
