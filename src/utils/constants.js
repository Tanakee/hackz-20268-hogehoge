export const RAIN_SPEED_SLOW = 1.1;     // m/s（ゲーム中の見かけの雨速。実機フィードバックにより1.5→1.1へ減速）
export const RAIN_SPEED_REAL = 7.0;     // m/s（現実の雨速・リプレイ後の速度）
export const REPLAY_MULTIPLIER = RAIN_SPEED_REAL / RAIN_SPEED_SLOW; // ≒ 6.36倍
// 同時に存在する雨粒数。開始直後はRAIN_COUNT_MINから始まり、GAME_DURATIONをかけて
// RAIN_COUNT_MAXまで増える（時間経過による難易度上昇）。序盤は「よけられる」ことを
// 優先してゆるやかに、終盤に増加が集中するイージングをかける（RainPhysics参照）。
// MIN=60→MAX=90（+50%）では実機で変化がほぼ体感できなかった（実機フィードバックにより
// MAX引き上げ＋終盤集中のイージングに変更）。
export const RAIN_COUNT_MIN = 60;       // 個（実機フィードバックにより150→60へ減量した値をそのまま開始値に採用）
export const RAIN_COUNT_MAX = 130;      // 個（終盤の密度上限。150は「多すぎ」と評価された値のため、それより少し下に設定）

// 雨の出現範囲（プレイヤー = local-floor 原点 が中心）。
// core（RainPhysics）と presentation（RainRenderer の表示範囲・地面の水しぶき位置）が
// 同じ値を参照できるよう共有定数化。
export const RAIN_SPAWN_RADIUS = 1.5;   // m（xz平面の出現半径。1.2→1.5へ拡大し密度を下げた）
export const RAIN_SPAWN_HEIGHT = 3.0;   // m（雨の出現上限の高さ。実機フィードバックにより2.2→3.0へ引き上げ）
// この高さまで落ちたら再出現。「y=0が本当の床」というlocal-floorの前提は、
// 実機（PICO Browser＋この端末の床キャリブレーション）では信用できないと判明した
// （実機フィードバック：直立時のhead.yが0.64などの明らかにおかしい値になる＝
// 原点が本当の床ではなく、セッション開始時点の頭の位置に近いものになっている）。
// 原点の意味が多少ズレていてもしゃがんだ頭・手を確実にカバーできるよう、
// 0ではなく余裕を持ってマイナス側まで下げてある。
export const RAIN_GROUND_Y = -1.0;      // m

// PLAYING開始時、雨粒はRAIN_COUNT_MIN個を一気に出現させず、この秒数をかけて
// 少しずつ（高頻度で少量ずつ）投入し、開始時の下限に達する。一気に全部出すと
// 「開始直後から囲まれている」「段階的に降ってくる（塊のまま循環する）」
// という2つの問題が同時に起きていたため、投入自体を時間分散させて解決する
// （実機フィードバックにより変更。高さの初期分散だけでは解決しなかった）。
export const RAIN_RAMP_UP_DURATION = 2.5; // 秒

// 雨の降下方向モード（垂直⇔斜め）。同時に混在させるのは非現実的なため、
// 一定間隔で「風向き」ごと切り替える（実機フィードバックにより追加。
// 「ほぼ動かずにクリアできる」問題への対策：垂直の雨だけだと体を横にずらす
// だけで避けられてしまうため、斜め方向の雨で回避行動のバリエーションを要求する）。
// 瞬間的にパキッと切り替わると不自然なため、RAIN_MODE_TRANSITION 秒かけて
// 「風が強まる/収まる」ように風速をなめらかに遷移させる（実機フィードバックにより追加）。
export const RAIN_MODE_DURATION = 10;      // 秒（このサイクルで垂直/斜めを切り替える。6→10へ延長）
export const RAIN_MODE_TRANSITION = 2.5;   // 秒（切り替え時、風速がなめらかに変化するのにかかる時間）
export const RAIN_TILT_ANGLE_DEG = 30;     // 度（斜めモード時、鉛直から何度傾くか）

export const PLAYER_HEAD_RADIUS = 0.15; // m
export const PLAYER_HAND_RADIUS = 0.05; // m（実機フィードバックにより0.15→0.05へ縮小。手のひら程度のサイズに）

// 雨粒の当たり判定半径。core（PlayerCollider）とpresentation（RainRendererの見た目の
// ストリーク半径）で同じ値を参照し、「見た目より判定が大きくて理不尽」を防ぐ。
// 実機フィードバックにより、見た目のストリーク半径に一致させた（従来は0.03mで見た目より大きかった）。
export const RAIN_DROP_RADIUS = 0.0045; // m
export const GAME_DURATION = 30;        // 秒
export const PLAYER_LIVES = 3;          // 被弾許容回数
export const READY_DURATION = 3;        // 秒（START後の準備カウントダウン。この間は雨もタイマーも動かない）
