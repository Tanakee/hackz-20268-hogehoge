# 開発計画書 - 雨避けVRゲーム

> ゲーム内容の詳細は `GAMESPEC.md` を参照。本書は**技術スタック・役割分担・開発進行**を定義する。

---

## プロダクト概要

PICO 4 Ultra上で動作するWebXR製の雨避けMRゲーム。
プレイヤーはパススルーで見える現実世界の中でゆっくり降る雨を避ける。
クリア後、実際の雨速（約6〜9 m/s）に倍速したリプレイ映像を三人称で見て「本物の雨をリアルタイムで避けていた」驚きを体験する。

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
| **ゲーム処理** | 物理・当たり判定・状態管理・録画・リプレイロジック・WebXRトラッキング・フリーカメラ制御 |
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
│   │   ├── Replayer.js           # 記録データをREPLAY_MULTIPLIER倍速で再生
│   │   └── ReplayCamera.js       # リプレイ中のフリーカメラ移動制御
│   │
│   ├── presentation/             # [演出担当]
│   │   ├── RainRenderer.js       # 雨粒の描画（InstancedMesh・水滴シェーダー）
│   │   ├── PlayerAvatar.js       # リプレイ時の人型簡易アバター（記録データに追従）
│   │   ├── HUD.js                # VR内UI（タイマー・ライフ残数）
│   │   ├── StartScreen.js        # スタート画面
│   │   ├── ReplayScreen.js       # リプレイ演出（速度表示・開始/終了フェード）
│   │   └── SoundManager.js       # SE（被弾音・クリア音・雨音）
│   │
│   └── utils/
│       └── constants.js          # 共有定数のみ
│
├── assets/
│   └── sounds/                   # [演出担当]
└── package.json                  # 共有
```

**ゲーム処理担当：** `src/core/` 以下すべて
**演出担当：** `src/presentation/` 以下すべて

---

## core / presentation の接続ルール

2つの担当が直接依存しないよう、**イベントとデータの一方向受け渡しで繋ぐ**。
`main.js` だけが両方を import して繋ぐ責任を持つ。

```
core（ゲーム処理）                    presentation（演出）
────────────────────────────────     ──────────────────────────────
RainPhysics.positions（Float32Array）→ RainRenderer が毎フレーム読む
Replayer.frame（記録データ）          → RainRenderer・PlayerAvatar が読む
Replayer.cameraTransform             → ReplayCamera が読む
GameManager.on('hit', payload)       → SoundManager・HUD がリッスン
GameManager.on('clear')              → ReplayScreen・SoundManager がリッスン
GameManager.on('gameover')           → ReplayScreen・SoundManager がリッスン
GameManager.on('stateChange', state) → HUD・StartScreen・ReplayScreen がリッスン
```

- `core` 側は `presentation` を直接 import しない
- `presentation` 側は `core` のデータ/イベントを読むだけ（書き込まない）

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

- [ ] リポジトリ初期化・ディレクトリ構成作成・package.json
- [ ] Vite + Three.js セットアップ、HTTPS開発サーバー起動確認
- [ ] **[最重要]** PICO 4 UltraブラウザでWebXR `immersive-ar` セッション（MRパススルー）が動くか実機確認
- [ ] 頭・コントローラーのトラッキング取得確認
- [ ] `constants.js` を先に定義（両担当が参照するため最初に確定）

### Phase 2：MVP実装（並行開発）

**ゲーム処理担当**
- [ ] `RainPhysics.js` - 雨粒の位置配列を毎フレーム更新（`positions: Float32Array`）
- [ ] `PlayerCollider.js` - 頭・手の球コライダー、雨粒との距離判定
- [ ] `GameManager.js` - 状態遷移・ライフ管理（3回被弾でGAMEOVER）・タイマー（30秒）
- [ ] `Recorder.js` - フレームごとに頭・手・雨粒位置・被弾イベントをバッファに記録
- [ ] `Replayer.js` - 記録データを `REPLAY_MULTIPLIER` 倍速で再生するイテレーター

**演出担当**
- [ ] `RainRenderer.js` - InstancedMeshで雨粒を描画（位置はPhysicsから受け取るだけ）
- [ ] `HUD.js` - タイマー・ライフ残数のVR内表示
- [ ] `StartScreen.js` - VR内スタート画面（コントローラーボタンで開始）
- [ ] `SoundManager.js` - 被弾音・クリア音・雨音の最低限実装

### Phase 3：統合（Phase 2完了後）

- [ ] `main.js` でcore/presentationを接続（イベント・データの配線）
- [ ] PLAYING → CLEAR/GAMEOVER → REPLAY → START の一連フロー動作確認
- [ ] `PlayerAvatar.js` - リプレイ時の人型簡易アバター実装
- [ ] `ReplayCamera.js` - スティックで移動・コントローラー向きで視点のフリーカメラ
- [ ] `ReplayScreen.js` - リプレイ開始/終了のフェード演出

### Phase 4：調整・仕上げ

- [ ] 実機で難易度調整（`RAIN_COUNT`・`RAIN_SPEED_SLOW`・`GAME_DURATION`）
- [ ] パフォーマンス確認（雨粒150本で90fps維持できるか）
- [ ] リプレイ体験の確認（「本物の雨を避けていた」驚きが伝わるか）
- [ ] Vercelデプロイ・発表用URL確定

---

## 未決事項（実装前に決定が必要なもの）

| # | 内容 | 担当 |
|---|------|------|
| 1 | WebXR `immersive-ar` でPICO 4 Ultraのパススルーが使えるか → Phase 1で実機確認 | 共有 |
| 2 | コントローラー（手）側の当たり判定コライダー半径 | ゲーム処理 |
| 3 | リプレイのフリーカメラ移動範囲制限・酔い対策（スナップターン等）の要否 | ゲーム処理 |
| 4 | リプレイ中の一時停止・巻き戻しを実装するか（初期スコープ外が推奨） | 共有 |
| 5 | HUDの具体的な見た目・配置 | 演出 |
| 6 | SE・雨音の方向性 | 演出 |

---

## 共有定数（constants.js）

```js
export const RAIN_SPEED_SLOW = 1.5;    // m/s（ゲーム中の見かけの雨速）
export const RAIN_SPEED_REAL = 7.0;    // m/s（現実の雨速・リプレイ後の速度）
export const REPLAY_MULTIPLIER = RAIN_SPEED_REAL / RAIN_SPEED_SLOW; // ≒ 4.67倍
export const RAIN_COUNT = 150;         // 同時に存在する雨粒数（難易度調整の主要パラメータ）
export const PLAYER_HEAD_RADIUS = 0.15; // m
export const GAME_DURATION = 30;        // 秒
export const PLAYER_LIVES = 3;          // 被弾許容回数
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
