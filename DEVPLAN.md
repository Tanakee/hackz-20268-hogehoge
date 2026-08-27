# 開発計画書 - 雨避けVRゲーム

> ゲーム内容の詳細は `GAMESPEC.md` を参照。本書は**技術スタック・役割分担・開発進行**を定義する。

---

## プロダクト概要

PICO 4 Ultra上で動作するWebXR製の雨避けMRゲーム。
プレイヤーはパススルーで見える現実世界の中でゆっくり降る雨を避ける。
クリア後、実際の雨速（約6〜9 m/s）に倍速したリプレイ映像を三人称で見て「まるで本物の雨を避けていたかのように見える」驚きを体験する。

---

## 技術スタック

| 項目 | 採用技術 |
|------|---------|
| フレームワーク | Three.js + WebXR Device API |
| 雨描画 | Three.js InstancedMesh |
| XRセッション | `immersive-ar`（MRパススルー） |
| トラッキング | WebXR（頭 + コントローラー2本） |
| ビルド | Vite（HTTPS必須） |
| デプロイ | Vercel または ngrok |
| 言語 | JavaScript (ES Modules) |

---

## 役割分担

| 役割 | 担当範囲 |
|------|---------|
| **ゲーム処理** | 物理・当たり判定・状態管理・録画・リプレイロジック・WebXRトラッキング |
| **演出** | 雨の見た目・アバター・UI/HUD・SE・リプレイ画面演出 |

---

## ディレクトリ構成と担当

```
/
├── index.html                    # 共有
├── src/
│   ├── main.js                   # エントリポイント・core/presentation接続（共有）
│   │
│   ├── core/                     # [ゲーム処理担当]
│   │   ├── GameManager.js        # 状態管理（START/PLAYING/CLEAR/GAMEOVER/REPLAY）
│   │   ├── RainPhysics.js        # 雨粒の位置更新・速度管理
│   │   ├── PlayerCollider.js     # 頭・コントローラーの球コライダー・当たり判定
│   │   ├── Recorder.js           # 毎フレームの頭・手・雨粒位置と被弾イベントを記録
│   │   └── Replayer.js           # 記録データをREPLAY_MULTIPLIER倍速で再生
│   │
│   ├── presentation/             # [演出担当]
│   │   ├── RainRenderer.js       # 雨粒の描画（InstancedMesh・縦ストリーク・風で傾く）
│   │   ├── PlayerAvatar.js       # リプレイ時の人型アバター（Quaternius glTF・頭追従＋腕Two-Bone IK・脚固定）
│   │   ├── HitEffect.js          # 被弾演出（赤フラッシュ・左右コントローラー振動）
│   │   ├── HUD.js                # VR内UI（残秒・ハート・リプレイ進行バー）・視界追従の3Dパネル
│   │   ├── ColliderIndicator.js  # PLAYING中、頭・手の当たり判定半径を半透明球で可視化
│   │   ├── TitleScreen.js        # START中のタイトル演出（宙で止まった雨が液体の文字を結ぶ＋開始看板）
│   │   ├── StartScreen.js        # START/RESULT のパネルと selectstart（start/startReplay/restart）
│   │   ├── ScorePanel.js         # RESULT のスコア＋ランク（S/A/B/C）カウントアップ表示
│   │   ├── ReplayScreen.js       # リプレイ開始/終了フェード演出
│   │   ├── SoundManager.js       # SE（rain ループ / hit / clear / gameover）・すべて CC0
│   │   └── _panel.js             # CanvasTexture パネル生成ヘルパー
│   │
│   └── utils/
│       └── constants.js          # 共有定数のみ
│
├── public/                       # そのままのURLで配信（[演出担当]）
│   ├── sounds/                   # rain.mp3 / hit.mp3 / clear.mp3 / gameover.mp3（+ README）
│   └── models/                   # avatar.glb（Quaternius「Man」CC0）（+ README）
└── package.json                  # 共有
```

> 音声・アバターは当初 `assets/sounds/` を想定していたが、Vite の配信の都合で実体は
> `public/sounds/` `public/models/`（`${import.meta.env.BASE_URL}` 経由で読む）。

**ゲーム処理担当：** `src/core/` 以下すべて
**演出担当：** `src/presentation/` 以下すべて

---

## core / presentation の接続ルール

2つの担当が直接依存しないよう、**イベントとデータの一方向受け渡しで繋ぐ**。
`main.js` だけが両方を import して繋ぐ責任を持つ。

```
core（ゲーム処理）                    presentation（演出）
────────────────────────────────     ──────────────────────────────
RainPhysics.positions（Float32Array）→ RainRenderer が毎フレーム読む（PLAYING中）
Replayer.frame（補間済みの記録フレーム）→ RainRenderer・PlayerAvatar・HUD・SoundManager が読む（REPLAY中）
Replayer.progress（0〜1）             → HUD が読む（リプレイ進行バー）
GameManager.state / lives / timeRemaining → HUD・StartScreen・ScorePanel・TitleScreen・ColliderIndicator が毎フレーム読む
GameManager.on('hit', payload)       → SoundManager・HitEffect・HUD がリッスン
GameManager.on('clear')              → ReplayScreen・SoundManager・StartScreen・ScorePanel がリッスン
GameManager.on('gameover')           → ReplayScreen・SoundManager・StartScreen・ScorePanel がリッスン
GameManager.on('stateChange', state) → HUD・StartScreen・ReplayScreen・SoundManager がリッスン
```

- SE は `public/sounds/` に配置（`rain` / `hit` / `clear` / `gameover`。すべて CC0。出典・加工は同 README）
- リプレイ用アバターは `public/models/avatar.glb`（Quaternius「Man」CC0。詳細は同 README）
- `TitleScreen.js` / `ScorePanel.js` は `index.js` に1モジュール足すだけの追加モジュールで、
  StartScreen・core・状態機械には手を入れていない（TitleScreen は START 中、ScorePanel は RESULT 中だけ描画）

- `core` 側は `presentation` を直接 import しない
- `presentation` 側は `core` のデータ/イベントを**読むだけ**。ただし状態を進める
  **ライフサイクルメソッド**（`GameManager.start()` / `GameManager.startReplay()` /
  `GameManager.restart()`）は presentation から呼ぶ。core のフィールドを直接書き換えることはしない
- **リプレイ中に仮想カメラは存在しない**：視点はプレイヤーが被っているHMDの実トラッキングをそのまま使う（ゲーム中と同じレンダリングパイプライン）。アバター・雨は記録データを`local-floor`座標にそのまま再配置するだけで、カメラ制御コンポーネントは作らない

### Phase 2 実装の前提（演出↔core 合意事項・2026-08-27）

**モジュールの形（core / presentation 共通）**

- 各モジュール = クラス。`constructor(scene, ctx)` で自分のオブジェクトを `scene` に追加、
  毎フレーム `update(dt, ctx)` が呼ばれる、`dispose()` で後始末
- `ctx = { renderer, camera, game, rainPhysics, replayer, controllers }`
- 毎フレームの呼び出し順：`core.update()` → `presentation.update()` → `renderer.render()`
- `main.js`（新規・両者を配線する本体）は **Phase 3 で作成**。Phase 2 の間は
  core / presentation とも `main.js` を触らない（現 `main.js` は Phase 1 の検証用スケルトンのまま）

**イベント / データの詳細**

- `GameManager` は簡易エミッタ：`on(event, handler)` が解除関数を返す。`state` /
  `lives` / `timeRemaining` は公開プロパティ（HUD は毎フレーム読んでよい）
- `hit` payload = `{ rainIndex, part: 'head' | 'handLeft' | 'handRight', livesRemaining }`
  （被弾のワールド座標は含まない）
- CLEAR/GAMEOVER → RESULT は **core が自動遷移しない**。演出（ReplayScreen）が
  フェード＋余韻を終えたタイミングで `game.showResult()` を呼ぶ。尺は ReplayScreen が持つ
- RESULT画面では**リプレイを強制しない**。右トリガーで「リプレイ」（`game.startReplay()`。
  RESULT→REPLAY、何度でも選び直せる）、左トリガーで「終了」（`game.restart()`。RESULT→START）
  を選べる。左右の判定は `controller.userData.handedness`（main.jsがconnectedイベントで設定）を見る
- REPLAY → RESULT は `Replayer` が再生完了時に `game.finishReplay()` を呼ぶ（core 内で完結）
- リプレイのコマ間補間は **core（Replayer）側で行う**。presentation は `replayer.frame` を
  そのまま描くだけ。`replayer.progress`（0〜1）を HUD が参照する
- スタート操作：StartScreen が `ctx.controllers` の `selectstart` を検知して `game.start()` を呼ぶ
- 雨の出現範囲（`RAIN_SPAWN_RADIUS` / `RAIN_SPAWN_HEIGHT` / `RAIN_GROUND_Y`）は
  `constants.js` に共有定数化済み。core / presentation とも直書きせずここを参照する

---

## Gitブランチ運用

```
main
├── dev                # 統合ブランチ（直接pushしない）
├── feature/core-*     # ゲーム処理担当の作業ブランチ
└── feature/pres-*     # 演出担当の作業ブランチ
```

### ルール

- `main` への直接pushは禁止
- `dev` へのマージは必ずPRを立てる
- 1機能 = 1ブランチ
- マージ前に `git pull origin dev --rebase`
- `main.js` と `constants.js` の変更は必ず一声かけてからPR

---

## 開発フェーズ

### Phase 1：環境構築・検証（最初の30〜45分）

> **両担当同席で進める**。ここで詰まると全体が止まる。

- [x] リポジトリ初期化・ディレクトリ構成作成・package.json
- [x] Vite + Three.js セットアップ、HTTPS開発サーバー起動確認
- [x] **[最重要]** PICO 4 UltraブラウザでWebXR `immersive-ar` セッション（MRパススルー）が動くか実機確認
- [x] 頭・コントローラーのトラッキング取得確認
- [x] `constants.js` を先に定義（両担当が参照するため最初に確定）

### Phase 2：MVP実装（並行開発）

**ゲーム処理担当**
- [x] `RainPhysics.js` - 雨粒の位置配列を毎フレーム更新（`positions: Float32Array`）
- [x] `PlayerCollider.js` - 頭・手の球コライダー（各0.15m）、雨粒との距離判定
- [x] `GameManager.js` - 状態遷移・ライフ管理（3回被弾でGAMEOVER）・タイマー（30秒）・RESULT状態を含む状態遷移
- [x] `Recorder.js` - フレームごとに頭・手・雨粒位置・被弾イベント・残りライフをバッファに記録
- [x] `Replayer.js` - 記録データを `REPLAY_MULTIPLIER` 倍速で再生するイテレーター（コマ間補間・progress付き）

**演出担当**
- [x] `RainRenderer.js` - InstancedMeshで雨粒を描画（位置はPhysicsから受け取るだけ）
- [x] `HitEffect.js` - 被弾演出（画面フラッシュ赤点灯 + コントローラー振動）
- [x] `HUD.js` - 視界追従UI（ハートアイコン3つ・タイマー・リプレイ中の進行バー）
- [x] `StartScreen.js` - VR内スタート画面（トリガーボタンで開始）＋ RESULT画面兼用
- [x] `SoundManager.js` - 被弾音・クリア音・雨音ループ（フリー素材）

### Phase 3：統合（Phase 2完了後）

- [x] `main.js` でcore/presentationを接続（イベント・データの配線）
- [x] PLAYING → CLEAR/GAMEOVER → RESULT ⇄ REPLAY → START の一連フローを実機で確認
- [x] `PlayerAvatar.js` - 人型アバター（Quaternius glTF・頭追従＋腕Two-Bone IK・脚固定・身長自動スケール）。実機確認済み
- [x] `ReplayScreen.js` - リプレイ開始/終了のフェード演出

### Phase 4：調整・仕上げ

- [ ] 実機で難易度調整（`RAIN_COUNT`・`RAIN_SPEED_SLOW`・`GAME_DURATION`）※実機フィードバックで一部反映済み・引き続き調整
- [ ] パフォーマンス確認（`RAIN_COUNT` 本で90fps維持できるか）
- [ ] リプレイ体験の確認（「本物の雨を避けていた」驚きが伝わるか）
- [x] `SoundManager.js` に gameover 音を追加、SE 4種を CC0 素材で用意（`public/sounds/`）
- [x] `TitleScreen.js` - START 中のタイトル演出（宙で止まった雨が液体の文字を結ぶ＋「トリガーで開始」看板）
- [x] `ScorePanel.js` - RESULT にスコア＋ランク（S/A/B/C）カウントアップ表示
- [ ] タイトル演出の各フェーズ（SUSPEND/PAINT/HEARTBEAT）の実機での見え方調整
- [ ] Vercelデプロイ・発表用URL確定

---

## 未決事項（Phase 1で技術確認が必要なもの）

| # | 内容 | 担当 |
|---|------|------|
| 1 | ~~WebXR `immersive-ar` でPICO 4 Ultraのパススルーが使えるか~~ → **確認済み（動作OK）**。パススルー越しのオブジェクト重畳表示・頭/コントローラーのトラッキングともに実機で確認 | 共有 |
| 2 | パススルー時のパフォーマンス（雨粒150個のInstancedMesh描画と両立できるか） | ゲーム処理 |

---

## 共有定数（constants.js）

```js
export const RAIN_SPEED_SLOW = 1.1;     // m/s（ゲーム中の見かけの雨速。実機調整で1.5→1.1）
export const RAIN_SPEED_REAL = 7.0;     // m/s（現実の雨速・リプレイ後の速度）
export const REPLAY_MULTIPLIER = RAIN_SPEED_REAL / RAIN_SPEED_SLOW; // ≒ 6.36倍
export const RAIN_COUNT = 60;           // 同時に存在する雨粒数（難易度調整の主要パラメータ。実機調整で150→60）
export const RAIN_SPAWN_RADIUS = 1.5;   // m（xz平面の出現半径。実機調整で1.2→1.5）
export const RAIN_SPAWN_HEIGHT = 3.0;   // m（雨の出現上限の高さ。実機調整で2.2→3.0）
export const RAIN_GROUND_Y = 0;         // m（この高さまで落ちたら再出現）
export const RAIN_RAMP_UP_DURATION = 2.5; // 秒（PLAYING開始時、この時間をかけて雨粒を上限まで少しずつ投入）
export const RAIN_MODE_DURATION = 10;   // 秒（垂直/斜めモードを切り替えるサイクル）
export const RAIN_MODE_TRANSITION = 2.5; // 秒（切り替え時、風速がなめらかに変化する時間）
export const RAIN_TILT_ANGLE_DEG = 30;  // 度（斜めモード時、鉛直から何度傾くか）
export const PLAYER_HEAD_RADIUS = 0.15; // m
export const PLAYER_HAND_RADIUS = 0.05; // m（実機調整で0.15→0.05）
export const RAIN_DROP_RADIUS = 0.0045; // m（雨粒の当たり判定半径。見た目のストリーク半径と一致させた）
export const GAME_DURATION = 30;        // 秒
export const PLAYER_LIVES = 3;          // 被弾許容回数
export const READY_DURATION = 3;        // 秒（START後の準備カウントダウン）
```

---

## AI開発ツール分担

| ツール | 主な用途 |
|--------|---------|
| Claude Code | 設計・デバッグ・複雑なロジック（core/ 中心） |
| OpenAI Codex | コンポーネント量産・繰り返し実装（presentation/ 中心） |

同じファイルを同時に両ツールに触らせない。

---

## デプロイ・動作確認

```bash
# 開発サーバー（WebXRはHTTPS必須）
npx vite --https

# PICO 4 Ultraから接続
# 同じWi-FiでIPアドレスを直接入力
# または外部公開
ngrok http 5173
```
