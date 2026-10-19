# umeboshi-ask (OSS)

English: [README.md](README.md)

英語版を正文とします。内容に差がある場合は英語版を優先してください。

Anki向けのセルフホスト型自習ヘルパーです。
Cloudflare Workerのコア、Anki用パネル、Ankiアドオンを1つのパッケージにまとめています。

ライセンスはMITです。

## 動作条件

- Node.js 24 LTS、npm、Gitが必要です。
- Wrangler 3.xが必要です(3.114.17での動作を確認しています)。
- アドオンをAnkiで試すにはAnki Desktop 25.09.2以降が必要です。
- Cloudflareアカウントが必要なのはデプロイ時だけで、手元での実行やテストには不要です。

## 内容

- `claudeflare/src/core.ts`: Workerのコア
(支払い無し、ログイン経路無し)。
- `src/components/askScaffold.ejs`: パネルの源
(`npm run build` で描画します)。
- `addon/`: Ankiアドオン
(Python、注入のみ)。

## 導入 (3手順)

必要な秘密情報はOpenRouterのAPIキー1つだけです。
ログインは不要です。

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

`wrangler.oss-local.toml` は手元専用のファイルなので、commitしないでください。
`ASK_TOKEN` は任意で、保存(スレッド、設定)にだけ使います。

`[[kv_namespaces]]` がなくても雑談とモデル一覧は動きます。
この場合はスレッドと設定が残らず、パネルは手元の設定に切り替わります。

### 2. パネルを Anki に足す

1. `npm run build` と `npm run build:addon` を実行します。
   パッケージはrepo直下の `umeboshi-ask-companion.ankiaddon` です。
2. Ankiで ツール > アドオン > ファイルからインストール を開いてパッケージを選び、
   Ankiを再起動します。
3. ツール > アドオン で `umeboshi-ask: Inject ask` を選び、
   ノートタイプを指定して適用を押します。
   詳しくは [CONTRIBUTING.md](CONTRIBUTING.md#check-panel-and-add-on-behavior-in-anki) をご覧ください。

### 3. パネルを Worker に向ける

パネルの設定を開いて、次の2件を貼り付けます。

- Worker URL = `http://127.0.0.1:8799`
- Access token = `ASK_TOKEN` と同じ値

パネルが保存するキーは次のとおりです。

- `umeboshi-ask:worker-url:v1`
- `umeboshi-ask:worker-token:v1`

次の手順で往復を確認します。

1. 質問すると、答えがストリーミングで返ります。
2. 保存(threads POST)してからパネルを再構築し、
threads GETに残っていることを確認します。
3. トークンを誤った値に変えて質問します。
401とともに「設定の access token を見る」
案内が表示されます。

## 台本

- `npm run build`: パネルを描画します
(`addon/templates/inject.html`)。
- `npm run build:addon`: `.ankiaddon` を固めます
(先に `build` します)。
- `npm test`: root試験 (`node --test`)。
- `npm run test:core`: Workerコア試験
(`claudeflare/test/core`)。

## パッケージとして使う

[`@umeboshi/ask`](package.json) を依存関係に入れるとソースを使い回せます。

```sh
npm install @umeboshi/ask
```

すぐに使えるJSのSDKではなく、ソースの配布です。

- `./core` (`claudeflare/src/core.ts`): Workerコアのソース。
- `./panel` (`src/components/askScaffold.ejs`): パネルのソース。
- `./addon` (`addon/inject.py`): アドオンの入口。
- `./package.json`: パッケージ情報のみ。

Ankiで使う場合は上記の導入手順に従い、これらのファイルを直接読み込まないでください。

## 開発への参加

質問、機能提案、開発環境の用意、PRの手順は
[参加ガイド](CONTRIBUTING.md)をご覧ください。
投稿や議論には英語を使ってください。翻訳ツールを使ってもかまいません。

## 境界

境界番 (`test/oss-boundary.test.mjs`) が課金語を
この tree から締め出す。課金語を持ち込むな
(EN の Boundary 節にある語、
およびその日本語形)。
Worker が送るモデル単価の字段は
受け取るだけで、持ち込みでは無いので
走査から外す (EN の Boundary 節と同じ扱い)。

## 困ったら

- 401: パネルの設定にあるaccess tokenを確認します。
`ASK_TOKEN` と一致している必要があります。
- 保存できない: `[[kv_namespaces]]` がないと
スレッドと設定は残りません。
パネルは手元の設定に切り替わります。
- 雑談が503を返す:
`OPENROUTER_API_KEY` が設定されていません。
- 呼び出しをbrowserが止める: CORSを確認します。
コアは既知のオリジンにだけ答えます
(Anki Desktop、AnkiWeb、
AnkiDroid用のloopback、同一オリジン)。

## よくある質問

- カードはどこに送られますか?
  パネルは組み立てた質問を自分のWorkerに送ります。
  自分のWorkerはOpenRouterに転送し、
  OpenRouterは選んだモデルの提供先に転送します。
  セルフホストとは入口を自分で動かすことであり、
  答えを自分の端末で作ることではありません。
- 使えるモデルは何ですか?
  固定のbundleで次の5件です:
  `xiaomi/mimo-v2.5`、
  `z-ai/glm-5.3-flash`、
  `xiaomi/mimo-v2.6-pro`、
  `google/gemini-3.8-flash`、
  `anthropic/claude-opus-5.5`。
- 保存には何が必要ですか?
  `ASK_TOKEN` とKVの紐づけです。
  ない場合、スレッドと設定は端末内にだけ残ります。

## 助けを求める

- [不具合の報告](https://github.com/Karimuto/umeboshi-ask/issues/new?template=bug_report.md)。
- [機能の提案](https://github.com/Karimuto/umeboshi-ask/issues/new?template=feature_request.md)。
- [セルフホストの困りごと](https://github.com/Karimuto/umeboshi-ask/issues/new?template=selfhost_help.md)。
- [Discussions](https://github.com/Karimuto/umeboshi-ask/discussions)
  で使い方の共有や利用者同士の意見交換。

## ホスト版

ホスト版がある。
セルフホストしたくない人向け。
違いはログイン、
支払い、同期だけ。
この repo には無い。
ホスト版は運営者に聞く。
