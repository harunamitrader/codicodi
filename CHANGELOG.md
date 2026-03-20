# 変更履歴

このファイルでは、このプロジェクトの主な変更を記録します。

## 0.1.23 - 2026-03-21

- NSIS installer に `icons/icon.ico` を明示指定し、setup exe 側でもアプリアイコンを使うよう調整
- バージョン番号と PWA キャッシュを `0.1.23` に更新
- `npm run tauri:build` で `0.1.23` の MSI / NSIS installer を再生成

## 0.1.22 - 2026-03-21

前回の GitHub 公開版 (`0.1.0`) からの主な更新:

- セッション復旧まわりを改善
  - `Restore Chat` で DB から会話履歴を再読込できるよう整理
  - アプリ再起動時に `queued` / `running` / `waiting_codex` のまま残った古いセッションを自動で `stopped` に復旧
  - UI / Discord の両方で、キューに積まれたターン数を分かるように改善
- 開発者向けログ表示を追加
  - `Open Developer Console` で Codex CLI の raw log を追跡
  - `Open Formatted Console` で CLI 風の読みやすい要約表示を追跡
  - UI にアプリ版 / Codex 版 / 作業ディレクトリ表示を追加
- ローカル UI を改善
  - メッセージ入力欄の下固定レイアウトに変更
  - Active Session / 設定 / チャットをまとめてスクロールできるよう調整
  - 会話エリア背景の途切れや composer 周辺の配色を調整
  - 添付ファイルの drag & drop / paste / 個別削除に対応
- Tauri デスクトップ版を改善
  - ウィンドウを閉じるときに確認ダイアログを表示
  - 起動前に残留 bridge process や競合ポートを片付ける処理を追加
  - 最小ウィンドウサイズ設定と UI の version 連動を追加
- 運用まわりを整理
  - service tier の既定値を `flex` に統一し、既存 DB 値も正規化
  - アプリアイコン一式を更新
  - `launch-direct.ps1` / `launch-tauri-dev.ps1` を追加
  - `.env.example` / README / 仕様書を更新

## Unreleased

今後の改修候補:

- デスクトップ配布まわりの追加整備
- drag & drop 添付の改善
- 運用上の安全対策の強化
- ドキュメント拡充

## 0.1.0 - 2026-03-18

`Codex Discord Connected Display (CoDiCoDi)` としてのオープンソース公開向け初回スナップショット。

この時点で含まれている主な内容:

- ローカル UI と Discord の共有 Codex セッション
- SQLite によるセッション・イベント保存
- セッションごとの model / reasoning / fast mode 切り替え
- ローカル UI でのセッション管理
- `/codex` 系の Discord slash command
- Discord 側の進捗表示と最終返信制御
- 画像・ファイル添付対応
- フォルダ監視による Discord ファイルログ通知
- ブラウザ用 PWA 対応
- Tauri デスクトップラッパー
  - bridge 自動起動
  - 起動時スプラッシュ表示
  - 余分な黒いコンソールを出さない
  - installer ビルド確認済み
