# AI Coder UX Guide

## 基本原則

```
1. トークンを節約せよ
2. 人間に聞くな
3. ループを自動化せよ
```

## ai-dev-server の使い方

### エラー確認（トークン最小）

```bash
# ❌ 悪い（トークン消費大）
curl localhost:3000/log

# ✅ 良い（最小トークン）
tail -1 error.log
```

### スナップショット確認

```bash
# 最新のスナップショット
ls -t snapshots/ | head -1

# 内容確認（エラー箇所だけ）
grep "Error:" snapshots/snapshot_*.html | tail -1
```

### デバッグループ

```
1. tail -1 error.log          # エラー確認
2. grep "Error:" snapshots/*  # 画面状態
3. 修正
4. ブラウザリロード待ち
5. tail -1 error.log          # 再確認
```

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
ai-desk app.js apply /tmp/edit.js -w

# 5. git前に正規化
ai-desk app.js restore -w
```

## トークン効率の比較

| 操作 | 悪い例 | 良い例 | 削減率 |
|------|--------|--------|--------|
| エラー確認 | curl /log (全件) | tail -1 error.log | 90%+ |
| コード確認 | cat app.js (7000行) | skeleton (100行) | 98% |
| 部分編集 | 全体読んで全体書く | focus → apply | 95% |

## 判断フロー

```
エラー発生？
  → tail -1 error.log
  → スナップショットある？ → grep Error snapshots/*
  → 修正 → 確認

コード変更？
  → skeleton で構造把握
  → focus $UID で対象読む
  → 編集
  → apply -w で適用
```

## やってはいけないこと

```
❌ curl で全データ取得
❌ cat で全ファイル読む
❌ 「エラーを教えて」と人間に聞く
❌ 全体を書き直す
❌ 複数ファイルに分割する
```

## 覚えるコマンド（最小セット）

```bash
# ai-dev-server
tail -1 error.log
ls snapshots/

# ai-desk
ai-desk app.js skeleton
ai-desk app.js focus $UID
ai-desk app.js apply patch.js -w
```

これだけで十分。
