# 技術アーキテクチャ

方針: お任せ推奨構成。**TypeScript 中心・モノレpo・OSS 積極活用**（ユーザー方針に合致）。

## 1. スタック選定

| 層 | 選定 | 理由 |
|---|---|---|
| リポジトリ | pnpm + Turborepo モノレpo | apps(web) / packages(core, agent-runtime, connectors) / agents(spec) を分離 |
| フロント/サーバ | **Next.js 16 (App Router) + TypeScript** | 1言語統一、Vercel or セルフホスト両可能 |
| UI | Tailwind + shadcn/ui + next-intl | 日英 i18n 最初から。shadcn はコピー型で AI-native 画面を作りやすい |
| DB | **Postgres 16 + pgvector** (Supabase か self-host) | SoR・knowledge・embedding を1本に。RLS でテナント分離 |
| ORM | Drizzle | TS-native、マイグレーション軽い |
| ジョブ/実行基盤 | **Phase 0: DBバックドのインプロセス runner**（runs テーブル + executor）。スケール時に Trigger.dev/Temporal へ置換 | Phase 0 は外部サービス非依存を優先。durable execution は抽象層 (`RunExecutor`) の背後に隠す |
| エージェント実行 | 自社ハーネス (spec → step runner) + **Vercel AI SDK** でモデル抽象化。Phase 0 は **MockProvider のみ**（実LLM呼出しなし） | mixture-of-models のルーティングを自分で持つ（製品の中核価値なので内製） |
| ツール/コネクタ | **Composio (OSS)** を当面の網 + Gmail/Slack/Calendar はネイティブ実装。**Phase 0 は全コネクタ mock** | 全コネクタ自前は無理。コアは自前、ロングテールは Composio |
| LLM 観測/eval | Phase 0: RunStep/cost を DB 記録。Langfuse (OSS) は後付け | run トレース・cost・評価を最初から計測 |
| 認証 | **Phase 0: 最小セッション認証 (自前)**。外販前に better-auth + SSO へ置換（Issue 化） | 外部サービス非依存・E2E容易性のため。本番投入前に必ず差し替えること |
| DB (dev/test) | **PGlite (Postgres WASM)** で hermetic に。docker-compose で実 Postgres も選択可 | Docker 不要で CI/E2E が回る。本番は RDS 等の実 Postgres |
| 送信基盤 | Google Workspace API 直 + 自社ドメイン/送信プール管理 | Instantly 相当の最小版を内製 |

## 2. コンポーネント構成

```
apps/
  web/                  # Next.js: UI + BFF API routes
packages/
  core/                 # entities, Drizzle schema, RLS helpers, domain logic
  agent-runtime/        # spec loader → step executor → model router → tool invoker
  signals/              # detectors: jobboards, filings, visitor-id, reply-classifier...
  connectors/           # gmail, gcal, slack, composio adapter, (later) salesforce/hubspot
  eval/                 # Langfuse wrapper, run scoring, judges
  knowledge/            # bitemporal knowledge graph read/write, entity resolution
agents/                 # 宣言的 spec (yaml) + prompts (md) — Git 管理、PR でレビュー
signals/                # シグナル定義 (yaml)
docs/                   # このドキュメント群
```

## 3. 実行フロー（Run の内部動作）

```
trigger (schedule | event | manual | api)
  → run 作成 (context snapshot: agent spec version + inputs)
  → for each step:
      model router が抽象ロール→具体モデル決定 (cost/latency/eval実績)
      → tool allowlist 内で function calling (connectors/DB/web)
      → structured output (zod schema) 検証、失敗はリトライ/降格
      → RunStep 記録 (input/output/tokens/latency)
  → approval_policy 判定
      required → Approval 作成して Outbox に保留
      none     → 直接 Outbox
  → act: Outbox 処理 (send/write/post)。reversible window 管理
  → learn: knowledge.write (claim + provenance + confidence)
  → eval: 遅延 judge (owner が動いたか等) → eval_score 記録
```

## 4. データ取込（Capture パイプライン）

- **Gmail/Calendar**: watch/webhook → message 正規化 → thread 化 → participant を Person 解決 → Conversation 保存 → embedding
- **シグナルソース**: 各 detector がポーリング/webhook → raw event 保存（イミュータブル）→ 正規化 → Account 解決（domain マッチ＋LLM 照合）→ SignalEvent
- **visitor-id**: 自社サイトに JS snippet（RB2B 相当を内製）。IP→組織 (MaxMind/DB-IP) + フォーム/メール既知アドレス突合 → Person/Account 解決
- **エンティティ解決は独立モジュール**（`knowledge/resolve`）に集約 — ここが精度の生命線。domain 正規化・別表記・日本語社名ゆれ対応

## 5. 決定事項と理由

| 決定 | 理由 |
|---|---|
| SoR 内製 (Salesforce 等に依存しない) | ユーザー方針。連携摩擦ゼロで社内導入、外販時に「CRM不要で動く」が武器になる。Frontrunner の構造的弱みを突く |
| エージェント spec を Git 管理 | 社内のエンジニアが直接書ける → 外販時はフォーム編集 UI を被せる二段構え |
| 全アクション承認制スタート | 社内で信頼を貯める → 外販時も監査証跡が営業武器になる |
| run の cost/eval を最初から記録 | 「10x 良い」の客観的証明になる。Frontrunner に見えない部分 |
| コネクタは Composio 併用 | 全自作は期間的に非現実。コア (gmail/slack/cal) だけ自前 |

## 5.5 Phase 0 安全方針

- **外部サービス・実送信は一切行わない**: 全コネクタは mock/fixture。`send_email` は tool として存在せず、Outbox + Approval 経由のみ（コード上の不変条件）
- 実 Postgres には接続しない（PGlite のみ）。本番データなし
- LLM API 呼出しなし（MockProvider のみ）

## 6. 主要リスク

| リスク | 対策 |
|---|---|
| スコープ過大 (SoR+シグナル+エージェント+送信 全部内製) | ロードマップで段階化。Phase1 は「受信取込+2シグナル+3エージェント+承認」に絞る |
| 日本語 LinkedIn 系データ源の薄さ | champion 異動はメール署名/名刺/プレスで代替検出 |
| エンティティ解決の精度 | 解決結果も Approval 経由にできる設計（confident 未満は人間確認） |
| LLM コスト | 抽象ロール+router で安いモデルへ自動降格、run 予算キャップ |
