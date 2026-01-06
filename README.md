# connpass-watcher

connpassの東京・オンライン開催イベントを監視し、登壇機会と興味マッチングを判定してGoogle Calendarに登録するCLIツール。

## 機能

- **イベント取得**: connpass API v2で東京・オンラインイベントを取得
- **登壇機会検出**: LT枠やCFP（発表者募集）を自動検出
- **興味マッチング**: キーワード + LLMのハイブリッド判定
- **人気イベント検出**: 参加者数が閾値以上のイベントを自動マッチ
- **カレンダー連携**: マッチしたイベントをGoogle Calendarに自動登録（色分け対応）
- **イベント更新追跡**: connpassでイベント情報が更新されたら自動で再処理・カレンダー更新
- **マルチLLM対応**: Anthropic, OpenAI, Google, Ollamaに対応

## インストール

```bash
bun install
bun run build
```

## 設定

`config.example.yaml`を`~/.connpass-watcher/config.yaml`にコピーして編集:

```yaml
connpass:
  api_key: "your-connpass-api-key"  # https://connpass.com/settings/api/
  prefectures:
    - tokyo
  include_online: true
  months_ahead: 2      # 何ヶ月先まで取得（1-12）
  # weeks_ahead: 4     # または週単位で指定（months_aheadより優先）

interests:
  keywords:
    - TypeScript
    - Rust
    - AI
  exclude_keywords:    # これらを含むイベントは除外
    - 輪読会
    - 読書会
    - もくもく会
  profile: |
    TypeScript, Rust, AIに興味のあるエンジニア
  min_participants: 50  # この人数以上は人気イベントとして自動マッチ

llm:
  enabled: true
  provider: anthropic  # anthropic, openai, google, ollama
  # model: claude-sonnet-4-20250514
  # api_key: "..."     # 省略時は環境変数から取得

google_calendar:
  enabled: true
  calendar_id: primary
  color_popular: "6"   # 人気イベントの色（みかん色）
  color_speaker: "9"   # 登壇機会ありの色（ブルーベリー色）
```

## 使用方法

### Google Calendar認証（初回のみ）

```bash
node dist/index.js auth
```

### イベントスキャン

```bash
# 一度だけ実行
node dist/index.js scan

# ドライラン（カレンダー登録なし）
node dist/index.js scan --dry-run

# JSON出力
node dist/index.js scan --json
```

### デーモンモード

```bash
node dist/index.js daemon
```

## GitHub Actions

### セットアップ

1. リポジトリの Settings → Secrets and variables → Actions で以下を設定:

#### Secrets（必須）

| Secret | 説明 |
|--------|------|
| `CONNPASS_API_KEY` | connpass APIキー |
| `LLM_API_KEY` | LLM APIキー（使用するプロバイダに応じて設定） |

#### Secrets（オプション）

| Secret | 説明 |
|--------|------|
| `GOOGLE_CALENDAR_CREDENTIALS` | Google OAuth credentials.json (Base64エンコード) |
| `GOOGLE_CALENDAR_TOKENS` | Google OAuth tokens.json (Base64エンコード) |

#### Variables（オプション）

| Variable | 説明 | デフォルト |
|----------|------|-----------|
| `MONTHS_AHEAD` | 検索期間（月単位、1-12） | `1` |
| `WEEKS_AHEAD` | 検索期間（週単位、1-52）※設定時はMONTHS_AHEADより優先 | - |
| `INTEREST_KEYWORDS` | 興味キーワード (JSON配列) | `["TypeScript", "Go", "AI", ...]` |
| `EXCLUDE_KEYWORDS` | 除外キーワード (JSON配列) | `["輪読会", "読書会", "もくもく会"]` |
| `INTEREST_PROFILE` | 興味プロファイル | `TypeScript, Go, AI/ML...` |
| `MIN_PARTICIPANTS` | 人気イベント閾値 | `50` |
| `LLM_ENABLED` | LLM有効化 | `true` |
| `LLM_PROVIDER` | LLMプロバイダ | `google` |
| `LLM_MODEL` | LLMモデル | `gemini-2.0-flash` |
| `GOOGLE_CALENDAR_ID` | カレンダーID | `primary` |
| `COLOR_POPULAR` | 人気イベントの色ID | `6` (みかん) |
| `COLOR_SPEAKER` | 登壇機会の色ID | `9` (ブルーベリー) |

### Google Calendar認証トークンの取得

ローカルで認証を行い、トークンをBase64エンコードしてシークレットに保存:

```bash
# 1. ローカルで認証
node dist/index.js auth

# 2. credentials.jsonをBase64エンコード
base64 < ~/.connpass-watcher/credentials.json

# 3. tokens.jsonをBase64エンコード
base64 < ~/.connpass-watcher/tokens.json

# 4. 出力をGitHub Secretsに設定
#    GOOGLE_CALENDAR_CREDENTIALS: credentials.jsonのBase64
#    GOOGLE_CALENDAR_TOKENS: tokens.jsonのBase64
```

### 手動実行

Actions タブから "Scan Connpass Events" → "Run workflow" で手動実行できます。

### スケジュール

デフォルトで毎日UTC 0:00（JST 9:00）に実行されます。変更する場合は `.github/workflows/scan.yml` の cron を編集してください。

## LLMプロバイダ

| プロバイダ | モデル例 | 環境変数 |
|-----------|---------|---------|
| google | gemini-2.0-flash (デフォルト) | `GOOGLE_API_KEY` |
| anthropic | claude-sonnet-4-20250514 | `ANTHROPIC_API_KEY` |
| openai | gpt-4o, gpt-4o-mini | `OPENAI_API_KEY` |
| ollama | llama3.2, mistral | (ローカル実行) |

### OpenAI互換API

Groq, Together等のOpenAI互換APIを使用する場合:

```yaml
llm:
  provider: openai
  model: llama-3.3-70b-versatile
  base_url: "https://api.groq.com/openai/v1"
```

## カレンダーの色

Google Calendarの色ID一覧:

| ID | 色名 | 用途例 |
|----|------|--------|
| 1 | ラベンダー | |
| 2 | セージ | |
| 3 | ブドウ | |
| 4 | フラミンゴ | |
| 5 | バナナ | |
| 6 | みかん | 人気イベント (デフォルト) |
| 7 | ピーコック | |
| 8 | グラファイト | |
| 9 | ブルーベリー | 登壇機会あり (デフォルト) |
| 10 | バジル | |
| 11 | トマト | |

## 開発

```bash
# 型チェック
bun run typecheck

# Lint
bun run lint

# フォーマット
bun run format

# ビルド
bun run build
```

## ライセンス

MIT
