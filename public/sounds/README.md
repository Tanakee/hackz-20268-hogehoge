# public/sounds

`SoundManager.js` が読み込む効果音。**フリー素材**を使用（GAMESPEC 8）。
Vite は `public/` 配下をそのまま配信するため、音声はここに置く。

| ファイル名 | 用途 | 長さの目安 |
|---|---|---|
| `rain.mp3` | 雨のループ（PLAYING / REPLAY 中に鳴る） | 5〜15秒・シームレスループ |
| `hit.mp3` | 被弾音（`hit` イベントで再生） | 〜0.5秒 |
| `clear.mp3` | クリア音（`clear` イベントで再生） | 〜2秒 |

- ファイルが無くてもゲームは動く（コンソールに警告が出るだけ）。
- 形式は `.mp3`。変える場合は `SoundManager.js` の拡張子も合わせる。
- 素材元とライセンスは取得時にここへ追記する。

> DEVPLAN のディレクトリ図では `assets/sounds/` になっているが、Vite の配信の都合で
> 実体は `public/sounds/`。図は次回更新時に読み替え。
