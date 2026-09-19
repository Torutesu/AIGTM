# AGENTS.md

## プロジェクト

AI-native GTM OS を作る。ベンチマークは Frontrunner (usefr.com)。詳細は `docs/` を読むこと — 特に `03-product-spec.md` が仕様の正典。

## 不変の設計原則

1. SoR（Account/Person/Deal/Conversation）は自社内製。外部CRMは「連携」であり「前提」にしない
2. シグナルとエージェントは宣言的 spec（`signals/*.yaml`, `agents/*.yaml` + `prompts/*.md`）で Git 管理
3. 破壊的操作（送信・書き戻し）は `Approval` + `Outbox` を必ず通る。UI でなくドメインモデル
4. 全 run は `RunStep` 記録 + cost/eval 計測。モデルは抽象ロール経由でルーティング（provider 非依存）
5. UI は日英 i18n（next-intl）。ハードコードされた文字列を置かない
6. 全データは `organization_id` でテナント分離（Postgres RLS）

## 用語

- **Signal**: 「定義 → 継続評価 → アカウント解決 → ICP採点」までを含む宣言的検知器
- **Run**: エージェント spec の1回の実行。step の連鎖、各 step は tool call または LLM reasoning
- **Compound/Learn**: run の成果を `Knowledge` (bitemporal, provenance 付き) に還元すること

## ランタイムの接続点（嘘をつかないための地図）

- `syncSpecs()`（agent-runtime/spec-sync）が `agents/*.yaml`・`signals/*.yaml` を全 org に upsert — worker 起動時・`ensureDb`・`pnpm db:sync`・`aigtm sync` で実行。yaml が正典、DB はレプリカ
- `internal_sor` シグナルは worker tick で評価（`deal.last_activity_at` 系）。外部 source（job_boards 等）はコネクタ待ち — webhook `type: "event"`/`"signal_event"` が代替経路
- Outbox dispatch は実装済み: `AIGTM_EMAIL_PROVIDER=resend` で email kind を実送信（失敗→`failed`→worker sweep が5回までリトライ）。未設定時は `dispatched` + audit `mock:true`（監査に残るので誤魔化さない）
- run の tx abort（ツールの SQL エラー等）でも rejected run + audit が別 tx で残る。tick 内の1 run のクラッシュは他を巻き込まない
- `evalScore` = 成功ステップ率（暫定の実測値。LLM-judge eval は未実装）
