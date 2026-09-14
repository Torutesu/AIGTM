# ロードマップ — 社内利用 → 外販

## Phase 0: 基盤（最初のマイルストーン）

- [ ] モノレpo + Next.js + Postgres(Drizzle+RLS) + better-auth + next-intl
- [ ] コアエンティティ schema (Org/User/Account/Person/Deal/Conversation/Signal/Agent/Run/Approval/Outbox/Knowledge)
- [ ] Gmail+Calendar 取込 → Conversation 正規化 → エンティティ解決
- [ ] エージェント spec ローダー + step runner + モデル router (AI SDK) + Langfuse 計測
- [ ] Approval キュー UI + Outbox

## Phase 1: 社内 MVP — 「動く revenue factory」最小構成

**狙い: 社内の営業/グロースが毎朝 Inbox を見る状態を作る**

- [ ] シグナル 2-3 本: 求人ウォッチ (Wantedly/Greenhouse 等) / 適時開示・プレス / Web訪問者
- [ ] エージェント 3-5 本（優先: Inbound SLA Routing, Stalled Deal Recovery, Meeting Prep, Weekly Digest, Auto-prospecting）
- [ ] Ask (NL→回答+引用) 最小版
- [ ] 全アクション承認制で運用開始
- [ ] **成功指標**: 週次でエージェント起案アクションの承認率 >50%、1件以上の商談/会議がエージェント経由で創出

## Phase 2: 社内での深化

- [ ] 送信基盤内製（シーケンス+返信分類）で outbound を内側に閉じる
- [ ] シグナル検出器を 10 種へ拡充（champion 異動、tech stack 変化、イベント参加者…）
- [ ] eval ループ: run 成果の遅延採点 → spec 改善ワークフロー
- [ ] Playbook 化（エージェント+シグナルのパックを export/import）
- [ ] 承認ポリシーの段階的引き下げ（信頼できた spec は自動化）

## Phase 3: 外販化

- [ ] マルチテナント検収（RLS 監査、org 分離テスト）
- [ ] self-serve オンボーディング（demo-gate 撤廃 = Frontrunner への直接対抗軸）
- [ ] 課金 (seat + run 従量)、BYOK
- [ ] Salesforce/HubSpot/Slack 等の外部連携（「内製SoRで完結」が売りだが、既存スタックからの移行パスとして）
- [ ] セキュリティ: SOC2 準備、データ保持ポリシー、監査ログ export
- [ ] 公開 LP（我々自身がこのプロダクトでシグナル駆動営業する dogfooding を証拠として見せる）

## オープンクエスチョン

1. 社内の営業対象セグメントと ICP 定義は誰が持つか → 初回セットアップで ICP yaml を一緒に作る必要あり
2. メールドメイン/送信プール（社内ドメインで送るか専用ドメインか）
3. 名刺/電話 (日本特有のチャネル) をどこまで取込対象にするか
4. 外販時の価格帯 — 参照: Unify ~$500/月、Common Room $2,500/月、Frontrunner 非公開。self-serve は $99-299/月帯が空き
