# AI Coder UX Guide

## 基本原則

```
1. トークンを節約せよ
2. 人間に聞くな、自分で操作して確かめよ
3. ループを自動化せよ
```

## ai-eyes の使い方（自律E2Eデバッグ）

AIはPlaywrightのような重い依存なしに、`ai-eyes`のREST API経由でブラウザを操作・観測できます。

### 1. クライアント操作（アクション）
ブラウザ内のUIを操作します。人間がクリックするのを待つ必要はありません。

```bash
# ボタンクリック
curl -X POST localhost:3000/input -H "Content-Type: application/json" -d '{"action": "click", "target": "#submit-btn"}'

# フォーム入力
curl -X POST localhost:3000/input -H "Content-Type: application/json" -d '{"action": "type", "target": "#username", "value": "test"}'

# 任意のJS実行（状態確認など）
curl -X POST localhost:3000/input -H "Content-Type: application/json" -d '{"action": "eval", "code": "console.log(document.title)"}'
```

### 2. 状態観測（スナップショット要求）
操作後の画面状態が反映されるまでブロッキングして待ち、スナップショットを取得します。

```bash
# 操作後に画面状態を要求して待機
curl -X POST 'localhost:3000/snapshot/request?label=after_click'
# → 完了するとファイル名（例: snapshot_xxx_after_click.html）が返る

# 取得したHTMLの確認（トークン節約のため一部だけ読む）
grep -A 10 "class=\"target-area\"" snapshots/snapshot_xxx_after_click.html
```

### 3. エラー確認（トークン最小）
操作によってエラーが発生したか確認します。

```bash
# ❌ 悪い（トークン消費大）
curl localhost:3000/log

# ✅ 良い（最小トークン）
tail -1 error.log
```

## AIの自律デバッグループ

人間を介在させず、以下のループを回してバグを修正・テストします。

```
1. curl /input でテスト操作を注入（click, type）
2. curl /snapshot/request で操作後の結果を観測
3. tail -1 error.log でエラー発生をチェック
4. エラー箇所やDOMの不備を ai-desk で修正 (focus → 編集 → apply)
5. 1に戻って修正が直ったか再テスト
```

---

## ai-desk の使い方

### 構造把握（トークン最小）

```bash
# ❌ 悪い（全体読む）
cat app.js

# ✅ 良い（構造だけ）
ai-desk app.js skeleton
```

### 必要な部分だけ読む

```bash
# 特定セクション
ai-desk app.js focus $AUTH01

# @high のみ
ai-desk app.js focus
```

### 編集ワークフロー

```bash
# 1. 構造確認
ai-desk app.js skeleton

# 2. 対象セクション読む
ai-desk app.js focus $TARGET > /tmp/edit.js

# 3. 編集して保存
# 4. 適用
ai-desk app.js apply /tmp/edit.js

# 5. 完了
git status 等で変更を確認

```

## トークン効率の比較

| 操作 | 悪い例 | 良い例 | 削減率 |
|------|--------|--------|--------|
| エラー確認 | curl /log (全件) | tail -1 error.log | 90%+ |
| コード確認 | cat app.js (7000行) | skeleton (100行) | 98% |
| 部分編集 | 全体読んで全体書く | focus → apply | 95% |

## やってはいけないこと

```
❌ curl で全データ取得
❌ cat で全ファイル読む
❌ 「エラーを教えて」「操作して」と人間に頼む
❌ 全体を書き直す
❌ 複数ファイルに分割する
```

## 覚えるコマンド（最小セット）

```bash
# ai-eyes: 操作と観測
curl -X POST localhost:3000/input -d '{"action":"click", "target":"#btn"}'
curl -X POST localhost:3000/snapshot/request
tail -1 error.log

# ai-desk: 編集
ai-desk app.js skeleton
ai-desk app.js focus $UID
ai-desk app.js apply patch.js -w
```
