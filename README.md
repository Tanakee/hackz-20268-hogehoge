# 雨避けMRゲーム

PICO 4 Ultra 上で動く WebXR（`immersive-ar` / MRパススルー）の雨避けゲーム。
現実の部屋（パススルー）に降る**ゆっくりの雨**を30秒よけてクリア。
その後、同じプレイを実際の雨速（約 6〜9 m/s）に倍速したリプレイを三人称で見返すと、
**「本物の雨をよけていたように見える」体感のギャップ**が生まれる——という体験が核。

ハッカソンのお題は「妄想」。子どもの頃、降ってもいない雨をよけていたつもりだった、あの感じ。

- 詳細な仕様: [`GAMESPEC.md`](./GAMESPEC.md)（ゲーム内容）/ [`DEVPLAN.md`](./DEVPLAN.md)（技術・分担・進行）

## 動かす

WebXR は HTTPS 必須。PICO 実機は同じ Wi-Fi から PC の IP で接続する。

```bash
npm install
npm run dev          # Vite dev（@vitejs/plugin-basic-ssl で HTTPS）
npm run build         # 本番ビルド（dist/）
npm run preview       # dist/ をローカル配信
```

- `public/` 配下（`sounds/` `models/`）はそのままのURLで配信される。
- 音声・アバターのファイルが無くてもクラッシュはしない（コンソール警告のみ）。

## 構成

```
src/
├── main.js            core と presentation を配線する本体（毎フレーム core→presentation→render）
├── core/              ゲーム処理（状態管理・物理・当たり判定・録画・リプレイ）
│   ├── GameManager.js   状態遷移 START→READY→PLAYING→(CLEAR|GAMEOVER)→RESULT⇄REPLAY・ライフ・タイマー
│   ├── RainPhysics.js   雨粒の位置・速度（垂直/斜めモード・風速のなめらか遷移・段階投入）
│   ├── PlayerCollider.js 頭・両手の球コライダーと雨粒の当たり判定
│   ├── Recorder.js      毎フレームの頭・手・雨粒位置・被弾・残ライフを記録
│   └── Replayer.js      記録を REPLAY_MULTIPLIER 倍速で再生（コマ間補間・progress）
├── presentation/      演出（core のデータ/イベントを読むだけ。状態はライフサイクルmethod経由でのみ進める）
│   ├── RainRenderer.js    雨粒の描画（InstancedMesh・縦ストリーク・風で傾く）
│   ├── PlayerAvatar.js    リプレイ中の人型アバター（Quaternius glTF・頭追従＋腕Two-Bone IK・脚は固定）
│   ├── HitEffect.js       被弾演出（赤フラッシュ・左右コントローラー振動）
│   ├── HUD.js             視界追従の3Dパネル（残秒・ハート・リプレイ進行バー）
│   ├── ColliderIndicator.js PLAYING中、頭・手の判定半径を半透明球で可視化
│   ├── TitleScreen.js     START中のタイトル演出（宙で止まった雨が液体の文字を結ぶ＋「トリガーで開始」看板）
│   ├── StartScreen.js     START/RESULT のパネルと selectstart（start/startReplay/restart）
│   ├── ScorePanel.js      RESULT のスコア＋ランク（S/A/B/C）・カウントアップ表示
│   ├── ReplayScreen.js    リプレイ開始/終了のフェード演出
│   ├── SoundManager.js    SE（rain ループ / hit / clear / gameover）・すべて CC0
│   └── _panel.js          CanvasTexture パネル生成ヘルパー
├── utils/constants.js  共有定数（雨速・数・当たり判定半径・時間・ライフ 等）
public/
├── sounds/  rain.mp3 / hit.mp3 / clear.mp3 / gameover.mp3（+ README に出典・加工）
└── models/  avatar.glb（Quaternius「Man」CC0 + README）
```

`core` と `presentation` は直接依存しない。`main.js` だけが両方を import して、
`ctx = { renderer, camera, game, rainPhysics, replayer, controllers }` とイベントで繋ぐ。

## ブランチ運用

`main` ← PR ← `dev` ← PR ← `feature/*`。`main` 直 push 禁止。`dev` へは必ず PR。
`main.js` と `constants.js` の変更は一声かけてから。詳細は `DEVPLAN.md`。

## 状態（随時更新）

- 実装済み: 状態機械・雨・当たり判定・録画・リプレイ・HUD・被弾演出・当たり判定可視化・
  効果音4種・人型アバター（腕IK・身長自動）・タイトル演出・スコア表示
- 調整中: 実機での難易度（`RAIN_COUNT` / `RAIN_SPEED_SLOW` / `GAME_DURATION`）・90fps・
  タイトル演出の各フェーズの見え方
- 未着手: Vercel デプロイ（発表用URL）
