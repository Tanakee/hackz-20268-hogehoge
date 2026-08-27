// PlayerAvatar の調整値はすべてここに集約する。
// 共有定数 src/utils/constants.js は core と契約で縛られているため触らない方針。
// 実機（PICO 4 Ultra）を見ながら数値を詰める前提。

export const MODEL_URL = `${import.meta.env.BASE_URL}models/avatar.glb`;

// この機能ごと無効化するスイッチ。true→false でアバターは一切描画されず、
// 実質「棒人間も出ない」状態に戻る（クラッシュはしない）。
export const ENABLED = true;

// avatar.glb（Quaternius「Man」/ CC0）のボーン名。実ファイルを読んで確認済み。
export const BONES = {
  head: "Head",
  neck: "Neck",
  chest: "Torso",
  hips: "Hips",
  shoulderL: "Shoulder.L",
  upperArmL: "UpperArm.L",
  lowerArmL: "LowerArm.L",
  handL: "Palm.L",
  shoulderR: "Shoulder.R",
  upperArmR: "UpperArm.R",
  lowerArmR: "LowerArm.R",
  handR: "Palm.R"
};

// 体・脚を自然な立ちポーズに保つための待機アニメ。無ければバインドポーズのまま。
export const IDLE_CLIP = "HumanArmature|Man_Idle";
export const IDLE_TIMESCALE = 0.6; // 待機モーションの再生速度（ゆっくり呼吸程度に）

// --- 身長スケール（head.y から自動）---
export const HEAD_PERCENTILE = 0.9; // 記録中の head.y のこの分位を「立ち目線高」とする（しゃがみで縮まないように）
export const EYE_TO_STATURE = 0.936; // 目の高さ / 全身長（フォールバック計算用の目安値）
export const FALLBACK_STATURE = 1.6; // 記録が無い/異常なときの全身長
// プレイヤーの目線高をこの範囲に丸めてから、モデルの素の目線高に合わせて等倍スケールする。
// モデルの素サイズが人間離れしていても（今の avatar.glb は頭が約4.2m）ここに収まる。
export const EYE_HEIGHT_CLAMP = [1.2, 2.0]; // m

// --- ルート（体全体）の追従 ---
export const POS_DAMP = 14; // 位置の指数追従係数（大きいほど機敏）
export const YAW_DAMP = 8; // 向きの指数追従係数
export const YAW_MAX_RATE = 6; // rad/s。急な首振りで体がスピンしないよう角速度を制限
export const MODEL_FACE_YAW_OFFSET = 0; // モデルが後ろ向きなら Math.PI を入れる

// 頭ボーンの向き補正（オイラー角ラジアン, XYZ）。記録の頭姿勢を反映したとき顔が
// 変な方向を向く場合にここで回す（リグのレスト姿勢差の吸収）。ハーネスで詰める。
export const HEAD_FIX_EULER = { x: 0, y: 0, z: 0 };

// --- 腕 IK ---
export const ARM_IK = true;
// 肘を向けたいおおよその向き（アバターのローカル: 下・少し外・少し後ろ）。実機で調整。
export const ELBOW_HINT_L = { x: 0.25, y: -1, z: -0.35 };
export const ELBOW_HINT_R = { x: -0.25, y: -1, z: -0.35 };
export const HAND_ORIENT = false; // 手ボーンの向きを記録データに合わせる。要実機調整なので既定 off（位置だけ合わせる）

// --- 見た目（「過去の自分」のエコー）---
export const COLOR = 0x9fe1ff;
export const OPACITY = 0.34;
export const RENDER_ORDER = 6; // 雨(InstancedMesh)より後に描く
export const WRIST_ORB = true; // 手首に小さな発光球。IK が多少ズレても手の位置が分かる保険＆ホログラム感
export const WRIST_ORB_RADIUS = 0.035;
