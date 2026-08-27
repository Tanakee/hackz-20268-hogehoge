# public/sounds

`SoundManager.js` が読み込む効果音。すべて **CC0（パブリックドメイン / 表示義務なし）** の素材を加工したもの。
Vite は `public/` 配下をそのまま配信するため、音声はここに置く。

| ファイル名 | 用途 | 長さ |
|---|---|---|
| `rain.mp3` | 雨のループ（PLAYING / REPLAY 中に鳴る） | 12.0 秒ループ |
| `hit.mp3` | 被弾音（`hit` イベント / REPLAY 中の記録被弾でも再生） | 約 1.4 秒 |
| `clear.mp3` | クリア音（`clear` イベント） | 約 3.8 秒 |
| `gameover.mp3` | ゲームオーバー音（`gameover` イベント） | 約 2.7 秒 |

- ファイルが無くてもゲームは動く（コンソールに警告が出るだけ）。
- 形式は `.mp3`。変える場合は `SoundManager.js` の拡張子も合わせる。

## 素材元とライセンス（すべて CC0）

| 出力 | 元素材 | 作者 | 取得元 |
|---|---|---|---|
| `rain.mp3` | 「Rain (loopable)」の MP3 #3 | Ylmir | https://opengameart.org/content/rain-loopable |
| `hit.mp3` | 「40 CC0 water / splash / slime SFX」の `splash_01` ＋「75 CC0 breaking / falling / hit sfx」の `bfh1_hit_02` | rubberduck | https://opengameart.org/content/40-cc0-water-splash-slime-sfx , https://opengameart.org/content/75-cc0-breaking-falling-hit-sfx |
| `clear.mp3` | 「Win Jingle」の `winfretless` | Fupi | https://opengameart.org/content/win-jingle |
| `gameover.mp3` | 「85 Short music jingles」の `jingles_NES00` | Kenney | https://opengameart.org/content/85-short-music-jingles |

## 加工内容（ffmpeg）

- `rain.mp3`: 元 #3 を **0.7 倍速**（`asetrate` によるテープ式スロー。雨をゆっくり降らせているゲームに合わせ、粒の間隔を空け音程も少し下げて「穏やかな雨」に）→ 12.00 秒でトリム（両端 15ms フェードのみ。雨は広帯域ノイズでループ継ぎ目は不可聴）→ ラウドネス正規化 `I=-24 LUFS`。
- `hit.mp3`: `splash_01`（音量 0.6）＋ `bfh1_hit_02`（8ms 遅延・音量 1.2）＋ 合成した 60Hz サブベース（0.45 秒・急減衰）を加算ミックス → リミッタ → `I=-16 LUFS`。「食らった」衝撃を出すため重低音を足している。
- `clear.mp3`: ラウドネス正規化のみ `I=-16 LUFS`。
- `gameover.mp3`: 元は上昇する“勝ち”ジングルなので **-7 半音**下げ（`asetrate`）て下降・脱力の“敗北”感に変換 → `I=-16 LUFS`。

> DEVPLAN のディレクトリ図では `assets/sounds/` になっているが、Vite の配信の都合で
> 実体は `public/sounds/`。図は次回更新時に読み替え。
