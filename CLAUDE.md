# プロジェクトメモ

## 動作確認 (プレビュー) について

このプロジェクトは Claude のリモートサンドボックス環境で開発しており、
Vite の dev server (`npm run dev`) はユーザー側のブラウザから直接到達できない。

動作確認をしたいときは Firebase Hosting のプレビューチャネルにデプロイする:

```bash
npx firebase hosting:channel:deploy <channel-name>
```

- 一時的なプレビューURLが発行される
- `<channel-name>` は短く分かりやすい名前 (例: `oekaki-3d-undo`)
- ユーザーに依頼する前に、ローカルでビルドが通ること (`npm run build`) を確認

`firebase.json` の rewrites により以下のパスでサブアプリにアクセスできる:
- `/oekaki-3d` → `public/apps/oekaki-3d/`
- `/oekaki` → `public/apps/oekaki/`
- `/camera-ar` → `public/apps/camera-ar/`
