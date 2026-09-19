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
- Outbox dispatch は kind 別プロバイダ解決: email→`AIGTM_EMAIL_PROVIDER=resend`、`post_slack`/`crm_write`/`create_task`→Settings「Integrations」の org webhook（Slack incoming webhook / 汎用 webhook）。未設定時は `dispatched` + audit `mock:true`（監査に残るので誤魔化さない）。失敗→`failed`→worker sweep が5回までリトライ
- run の tx abort（ツールの SQL エラー等）でも rejected run + audit が別 tx で残る。tick 内の1 run のクラッシュは他を巻き込まない
- `evalScore` = 成功ステップ率（実測値）。`AIGTM_EVAL_LLM_JUDGE=1` で完成 run に LLM-judge 評価を `eval_notes` へ追記（judge コストも `cost_cents` に計上）
- org 月次予算: `organizations.budget_monthly_cents`（Settings で設定）。当月 `runs.cost_cents` 合計が予算超過なら新規 LLM ステップ前に run を rejected
- Google Workspace 取り込み: Settings「Integrations」→「Connect Google Workspace」で OAuth 接続（`/api/google/connect` → callback が refresh token を暗号化保存）か手動貼付 → worker が5分スロットルで Gmail/Calendar → conversations に同期。失敗は org 単位で隔離
- Google SSO: `GOOGLE_OAUTH_CLIENT_ID/SECRET` 設定時にログイン画面へボタン表示。`ssoSignIn` は既存ユーザー照合 → 新規は org が1つの時のみ自動プロビジョン（複数 org で曖昧なら `sso_no_org` で拒否 — 勝手にテナントを選ばない）
- `conversations.external_id`（`gmail:`/`gcal:` 等の上流ID）が重複排除キー — subject 一致は fallback のみ。`(org_id, external_id)` の部分一意 index で DB レベルでも保証
- `worker_state` KV テーブル: 監査シンクの watermark・worker ハートビートを永続化。`AIGTM_AUDIT_WEBHOOK_URL` へ at-least-once 転送（初回は最新イベントにアンカー — 履歴ダンプしない）
- GDPR 消去: `@aigtm/db` の `erasePerson`/`eraseAccount` を admin 専用 server action から `withOrg` 内で呼ぶ。匿名化 tombstone（`[erased]`）＋監査記録、冪等
- `/api/metrics`: `AIGTM_METRICS_TOKEN` 設定時のみ有効、Bearer 必須。Prometheus text 形式
