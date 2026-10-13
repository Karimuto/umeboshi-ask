# umeboshi-ask (OSS)

English: [README.md](README.md)

原文は英語版が正。齟齬があれば英語版を優先すること。

Anki の自習ヘルパー。セルフホスト用。
Cloudflare Worker のコア、Anki のパネル、
Anki アドオンを1つにまとめたもの。

ライセンス: MIT。ホスト版
(ログイン、支払い、同期) はこの repo に無い。

## 内容

- `claudeflare/src/core.ts`: Worker のコア
(支払い無し、ログイン経路無し)。
- `src/components/askScaffold.ejs`: パネルの源
(`npm run build` で描画する)。
- `addon/`: Anki アドオン
(Python、注入のみ)。

## 導入 (2手順)

秘密は1つだけ: OpenRouter の API キー。
ログインは要らない。

### 1. Worker を起動する (手元)

```sh
cd claudeflare
cat > wrangler.oss-local.toml <<'EOF'
name = "umeboshi-ask-oss-local"
main = "src/core.ts"
compatibility_date = "2024-09-23"
# Keep this date as-is. It pins the Workers runtime the core was built for.
[[kv_namespaces]]
binding = "UMEBOSHI_KV"
id = "oss-local-kv"

[vars]
OPENROUTER_API_KEY = "<your-key>"
ASK_TOKEN = "<your-value>"
EOF
npx wrangler dev --config wrangler.oss-local.toml --port 8799
```

`wrangler.oss-local.toml` は自分の物。
commit しないこと。
`ASK_TOKEN` は任意。保存
(スレッド、設定) にだけ使う。

`[[kv_namespaces]]` が無くても
雑談とモデル一覧は動く。
スレッドと設定は残らず、
パネルは手元の設定に落ちる。

### 2. パネルを Worker に向ける

- Worker URL = `http://127.0.0.1:8799`
- Access token = `ASK_TOKEN` と同じ値

パネルが覚えるキー:

- `umeboshi-ask:worker-url:v1`
- `umeboshi-ask:worker-token:v1`

往復を確認する:

1. 質問する。答えが流れ返る。
2. 保存 (threads POST) し、パネルを再構築し、
threads GET に残るのを見る。
3. トークンを誤値に変えて質問する。
401 が「設定の access token を見る」
案内を出す。

## 台本

- `npm run build`: パネルを描画する
(`addon/templates/inject.html`)。
- `npm run build:addon`: `.ankiaddon` を固める
(先に `build` する)。
- `npm test`: root 試験 (`node --test`)。
- `npm run test:core`: Worker コア試験
(`claudeflare/test/core`)。

## 境界

境界番 (`test/oss-boundary.test.mjs`) が課金語を
この tree から締め出す。課金語を持ち込むな
(EN の Boundary 節にある語、
およびその日本語形)。
Worker が送るモデル単価の字段は
受け取るだけで、持ち込みでは無いので
走査から外す (EN の Boundary 節と同じ扱い)。

## 困ったら

- 401: access token を見る。
パネルの設定にある。
`ASK_TOKEN` と一致すること。
- 保存が壊れる: `[[kv_namespaces]]` が無いと
スレッドと設定は残らない。
パネルは手元の設定に落ちる。
- 雑談が 503 を返す:
`OPENROUTER_API_KEY` が無い。
- 呼出しを browser が止める: CORS を見る。
コアは既知の出所にだけ答える
(Anki Desktop、AnkiWeb、
AnkiDroid 用の loopback、同一出所)。

## ホスト版

ホスト版がある。
セルフホストしたくない人向け。
違いはログイン、
支払い、同期だけ。
この repo には無い。
ホスト版は運営者に聞く。
