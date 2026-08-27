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
  spine: "Abdomen",
  hips: "Hips",
  shoulderL: "Shoulder.L",
  upperArmL: "UpperArm.L",
  lowerArmL: "LowerArm.L",
  handL: "Palm.L",
  shoulderR: "Shoulder.R",
  upperArmR: "UpperArm.R",
  lowerArmR: "LowerArm.R",
  handR: "Palm.R",
  upperLegL: "UpperLeg.L",
  lowerLegL: "LowerLeg.L",
  footL: "Foot.L",
  upperLegR: "UpperLeg.R",
  lowerLegR: "LowerLeg.R",
  footR: "Foot.R"
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

// --- しゃがみ演出（頭が下がったら膝を曲げる）---
// 3点トラッキングでは脚は取得できない。頭を記録の高さに合わせるとアバター全体が沈み、
// 棒立ちの脚が床にめり込む。そこで「すねの先が床から出た量」をフィードバックして
// 膝の曲げ量を自動調整し、足を接地させたまま腰を落とす（＝しゃがんで見える）。
export const CROUCH_BEND = true;
export const KNEE_KP = 120; // フィードバック係数 rad/(m·s)。すね先の床貫通に応じて膝角を増やす速さ
export const KNEE_MAX = 2.4; // rad。膝の最大曲げ（約137度）
export const KNEE_DECAY = 4; // 1/s。貫通が無いとき曲げを立ち姿勢へ戻す速さ
export const KNEE_SMOOTH = 18; // 適用する曲げ角の平滑化（カクつき防止）
export const KNEE_THIGH_RATIO = 0.55; // 膝角に対する「腿を前に出す」割合（見た目のスクワット感）
export const KNEE_HIP_RATIO = 0; // 膝角に対する腰の前傾割合。>0 で前かがみ寄り
export const CROUCH_SIGN = 1; // 膝が逆（後ろ）に曲がるなら -1
export const FOOT_PLANT = 0.5; // フィードバックが追いつくまでの残差を吸収する接地補正 0..1

// --- 見た目（「過去の自分」のエコー）---
export const COLOR = 0x9fe1ff;
export const OPACITY = 0.34;
export const RENDER_ORDER = 6; // 雨(InstancedMesh)より後に描く
export const WRIST_ORB = true; // 手首に小さな発光球。IK が多少ズレても手の位置が分かる保険＆ホログラム感
export const WRIST_ORB_RADIUS = 0.035;

// 下半身を足元に向けて薄くフェード（推定の脚のアラを隠す・ホログラム感）
export const LEG_FADE = true;
export const LEG_FADE_TOP = 0.95; // 足元からこの高さ(m)で通常の不透明度
export const LEG_FADE_BOTTOM = 0.05; // 足元からこの高さ(m)以下は LEG_FADE_MIN 倍
export const LEG_FADE_MIN = 0.0; // 足元での不透明度係数（0 = 完全に消える）
