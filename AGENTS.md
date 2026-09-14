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
