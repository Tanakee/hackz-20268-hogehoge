import fs from "node:fs";
import * as THREE from "three";

const buf = fs.readFileSync("/Users/tanakee/Documents/development/hackathon/hackz-20268-hogehoge/public/models/avatar.glb");
const jsonChunkLength = buf.readUInt32LE(12);
const jsonStr = buf.slice(20, 20 + jsonChunkLength).toString("utf8");
const gltf = JSON.parse(jsonStr);

const nodes = gltf.nodes;
const byName = {};
nodes.forEach((n, i) => { if (n.name) byName[n.name] = i; });

function localMatrix(node) {
  const m = new THREE.Matrix4();
  if (node.matrix) {
    m.fromArray(node.matrix);
  } else {
    const t = node.translation ? new THREE.Vector3(...node.translation) : new THREE.Vector3();
    const r = node.rotation ? new THREE.Quaternion(...node.rotation) : new THREE.Quaternion();
    const s = node.scale ? new THREE.Vector3(...node.scale) : new THREE.Vector3(1, 1, 1);
    m.compose(t, r, s);
  }
  return m;
}

// 親子関係のマップを作る
const parentOf = {};
nodes.forEach((n, i) => {
  (n.children || []).forEach((c) => { parentOf[c] = i; });
});

function worldMatrix(idx) {
  let m = localMatrix(nodes[idx]);
  let p = parentOf[idx];
  const chain = [idx];
  while (p !== undefined) {
    chain.unshift(p);
    p = parentOf[p];
  }
  let world = new THREE.Matrix4();
  for (const i of chain) {
    world.multiply(localMatrix(nodes[i]));
  }
  return world;
}

function worldPos(name) {
  const idx = byName[name];
  const m = worldMatrix(idx);
  const pos = new THREE.Vector3();
  pos.setFromMatrixPosition(m);
  return pos;
}

const hips = worldPos("Hips");
const upperLegL = worldPos("UpperLeg.L");
const lowerLegL = worldPos("LowerLeg.L");
const footL = worldPos("Foot.L");
const head = worldPos("Head");
const rootNode = worldPos("RootNode");

console.log("Hips:", hips.toArray().map(v => v.toFixed(4)));
console.log("UpperLeg.L:", upperLegL.toArray().map(v => v.toFixed(4)));
console.log("LowerLeg.L:", lowerLegL.toArray().map(v => v.toFixed(4)));
console.log("Foot.L:", footL.toArray().map(v => v.toFixed(4)));
console.log("Head:", head.toArray().map(v => v.toFixed(4)));

const upperLen = upperLegL.distanceTo(lowerLegL);
const lowerLen = lowerLegL.distanceTo(footL);
console.log("upperLen (raw model units):", upperLen.toFixed(4));
console.log("lowerLen (raw model units):", lowerLen.toFixed(4));
console.log("total leg reach (raw):", (upperLen + lowerLen).toFixed(4));

// モデル全体の高さ（bounding box的にはHead付近が上端に近い、正確なBox3計算はしていないが目安として）
console.log("Head.y (raw model units, standing height proxy):", head.y.toFixed(4));
console.log("Hips.y (raw):", hips.y.toFixed(4));
console.log("hip-to-floor if foot.y is floor (raw):", (hips.y - footL.y).toFixed(4));

// TARGET_HEIGHT=1.7mへの自動スケール係数を、Head.y付近を身長の目安として概算
const approxScale = 1.7 / (head.y - footL.y);
console.log("approx auto-scale factor (TARGET_HEIGHT / (head.y-foot.y)):", approxScale.toFixed(4));
console.log("scaled upperLen (m):", (upperLen * approxScale).toFixed(4));
console.log("scaled lowerLen (m):", (lowerLen * approxScale).toFixed(4));
console.log("scaled total leg reach (m):", ((upperLen + lowerLen) * approxScale).toFixed(4));
console.log("scaled hip-to-floor (m):", ((hips.y - footL.y) * approxScale).toFixed(4));
console.log("REST_LEG_DROP constant used in code (m):", (1.7 * 0.47).toFixed(4));

console.log("\n--- 階層構造 ---");
function printTree(idx, depth) {
  const n = nodes[idx];
  console.log("  ".repeat(depth) + (n.name || `(node ${idx})`));
  (n.children || []).forEach((c) => printTree(c, depth + 1));
}
const rootIdx = gltf.scenes[gltf.scene ?? 0].nodes[0];
printTree(rootIdx, 0);
