# プロダクト仕様書 — AI-native GTM OS（仮称: AIGTM）

> 前提: Frontrunner のコアループを踏襲しつつ、**アプリケーション層（SoR）から内製**する。
> フェーズ1 = 社内利用、フェーズ2 = 外販（マルチテナントSaaS）。UIは日英両対応を最初から。

## 1. 製品定義

**「GTM の仕事を、シグナル検知から実行まで一気通貫でエージェントに委任できる OS」**

Frontrunner が「既存スタックの上のエージェント層」なのに対し、我々は **SoR・受信/送信・シグナル・エージェント・承認を一枚岩で作る**。連携不要で動き、連携するとさらに強い。

### コアループ（Frontrunner と同型、各要素を強化）

```
Capture   メール/カレンダー/電話/Web/外部ソースを取り込み、会社・人に解決
Context   統合コンテキスト = SoR (accounts/people/deals) + knowledge graph
Signal    シグナル定義を宣言的に書く → 継続評価 → ICP採点まで含む
Agent     トリガー (schedule/event/manual) で multi-step run。step毎にモデル選択
Approve   破壊的操作は全て人間ゲート (dry-run → diff → approve → audit)
Act       SoR書き戻し / メール送信 / Slack投稿 / タスク発行
Learn     run の成果物とフィードバックをコンテキストへ構造化還元 (compounding)
```

## 2. コアエンティティ（データモデル骨格）

| Entity | 概要 | 主要フィールド |
|---|---|---|
| `Organization` | テナント (外販前提で最初から分離) | id, plan, settings |
| `User` | 組織内ユーザー | role (admin/member/viewer), territory |
| `Account` | 会社 | domain, name, firmographics, icp_fit_score, owner_id, stage |
| `Person` | 人 (contact/lead/champion) | email, linkedin, role, account_id, relationship_history |
| `Deal` | 商談 | stage, amount, meddpicc JSON, last_activity_at |
| `Conversation` | メール/電話/会議の正規化スレッド | channel, participants, summary, embedding |
| `Signal` | シグナル定義 (宣言的 spec) | name, source, detector spec, icp_filter, schedule |
| `SignalEvent` | 発火したシグナル | signal_id, account_id, person_id, evidence JSON, score, detected_at |
| `Agent` | エージェント定義 (宣言的 spec) | spec (YAML), trigger, tools allowlist, approval_policy |
| `Run` | 実行インスタンス | agent_id, trigger_context, steps[], status, cost, eval_score |
| `RunStep` | run 内の1ステップ | tool/model, input, output, reasoning, latency, tokens |
| `Task` / `Approval` | 人間への依頼 | type (review_draft/approve_send/...), payload, sla |
| `Outbox` | 送信待ちアクション | kind (email/slack/crm_write), payload, reversible_until |
| `Segment` | 動的リスト | filter spec, materialized members |
| `Knowledge` | 蓄積コンテキスト | subject(account/person), claim, source_run_id, confidence, valid_from/to |
| `Playbook` | エージェント+シグナルの束（配布単位） | name, version, agents[], signals[] |

### 設計上の決定的ポイント

- **`Knowledge` は bitemporal**（valid_from/to + recorded_at）。「何をいつ知ったか」が run の学習根拠になる — Frontrunner の "compound" を実体化する部分
- **`SignalEvent.evidence`** に生の根拠（URL, 求人票抜粋, メール断片）を必ず保持 → Ask が引用付きで答えられる
- **`Approval` はエンティティとして独立**。UI の feature ではなくドメインモデル → 外販時の監査・SOC2 系の説得材料
- **`Outbox` は全て reversible window 付き**（送信前取り消し / 書き戻しの補償トランザクション）

## 3. シグナルエンジン

シグナルは「データソース + 検出手順 + アカウント解決 + ICP採点 + 起動するアクション」の宣言的定義。

```yaml
# signals/first-gtm-hire.yaml（イメージ）
name: First GTM hire
description: 過去にGTM採用実績のない企業が初めてGTM系ロールを出したら掴む
sources:
  - type: job_boards          # Wantedly, Greenhouse, Lever, LinkedIn Jobs...
    watch: {role_keywords: [GTM, growth, RevOps, グロース, 営業企画]}
resolve:
  entity: account
  constraints:
    - no prior GTM headcount  # 過去求人履歴と照合
score:
  icp_filter: default
actions:
  - emit: signal_event
  - enqueue_agent: account-research   # 自動で次の agent run へ
```

### 内製で実装するシグナル検出器（優先度順）

| # | 検出器 | ソース | 日本対応 |
|---|---|---|---|
| 1 | 求人ウォッチ | 公開求人 (Greenhouse/Lever/Wantedly/自社サイト) | ◎ Wantedly/求人票の日本語解析 |
| 2 | 適時開示/決算 | TDnet, EDINET, SEC, PR TIMES | ◎ 日本独自。Frontrunner の "Registry trace" 相当を日本でやれるのは我々だけ |
| 3 | 資金調達 | プレス + DB | ○ |
| 4 | Champion異動 | LinkedIn (連携 or 手動取込) | △ 日本はLinkedIn浸透率課題 → 名刺/メール署名変化も検出 |
| 5 | Web訪問者 | 自社サイトトラッカー (RB2B相当を内製: IP→組織解決 + 既知メール突合) | ◎ |
| 6 | 返信意図分類 | 内製メール送信基盤の返信を LLM 分類 | ◎ 日本語ビジネスメール対応が差別化 |
| 7 | 停滞ディール | SoR 内部データ | ◎ |
| 8 | テックスタック変化 | DNS/サイト/求人票 | ○ |
| 9 | GitHub/コミュニティ | stargazer/watcher → 会社解決 | ○ devtool 売る場合のみ |
| 10 | イベント参加者 | イベントリスト取込 | ○ |

## 4. エージェントハーネス

### エージェント = 宣言的 spec + ツール + 承認ポリシー

```yaml
# agents/stalled-deal-recovery.yaml
name: Stalled Deal Recovery
trigger:
  event: deal.no_activity
  where: days >= 14
  # or schedule: "0 9 * * MON" / manual
context:
  load: [deal, account, conversations(last 90d), knowledge]
steps:
  - id: diagnose
    model: reasoning            # 抽象ロール → router が具体モデル選択
    prompt: prompts/diagnose-stall.md
    output: {stall_reason, evidence[]}
  - id: draft
    model: writing
    prompt: prompts/recovery-note.md
    output: {note_draft}
approval:
  before_act: required          # 人間が承認するまで送信しない
act:
  - create_task: {assignee: deal.owner, payload: note_draft}
learn:
  - knowledge.write: {claim: stall_reason, about: deal}
eval:
  - judge: did_owner_act_within_7d   # 結果を後から採点 → spec 改善に還元
```

### モデルルーティング

- step は `model: reasoning | fast | writing | japanese` 等の**抽象ロール**を指定
- router が provider (Anthropic/OpenAI/Gemini/ローカル) へ、**cost・latency・evalスコア実績**で割付
- 「no single provider is a dependency」は踏襲。さらに **run 単位で token コストを記録・予算制御**

### Human-in-the-loop を一段強く

- `approval.before_act: required | threshold | none` を spec レベルで宣言
- Approval キュー UI: diff 表示（何を書く/送るか）、一括 approve、却下理由が learn に還元
- 初期は **全アクション承認必須**で社内運用 → 信頼が溜まった spec から段階的に自動化 (guardrail の引き下げは監査ログ付き)

## 5. アプリケーション層（内製 SoR 側 — Frontrunner に無い部分）

| モジュール | 内容 | 参考 |
|---|---|---|
| **Accounts/People/Deals** | 最小限だが正規化された CRM。フィールドはAIが推論・自動入力 | Attio |
| **Inbox 取込** | Gmail/Google Workspace API でメール・カレンダー・会議を自動取込 → Conversation 正規化 → エンティティ解決 | Day.ai |
| **送信基盤** | シーケンス・送信・返信検知まで内製（Instantly 相当のミニマム版）。warm-up/deliverability は後回し可 | Instantly |
| **Ask (Assistant)** | NL → コンテキスト横断クエリ。**全回答に evidence 引用** | Frontrunner Assistant mode |
| **Briefings** | Slack/メールへの定期 brief（Weekly Pipeline Digest 等） | — |

設計思想: **人間がフィールドを埋める CRM にしない**。会話・シグナル・run から AI が書く。人はレビューするだけ。

## 6. UX サーフェス（画面）

1. **Today / Inbox** — 新着 SignalEvents + 承認待ち Approvals + エージェントが起案したタスク（「何が起きて、何をすればいいか」の1画面）
2. **Signals** — シグナル定義一覧 + 発火フィード（evidence 付き）
3. **Agents** — ライブラリ + spec 編集（YAML/フォーム両対応）+ run 履歴（step 展開、cost、eval）
4. **Accounts / People / Deals** — SoR ビュー（テーブル+詳細）。全項目に「AIがいつ何から推論したか」の provenance
5. **Ask** — チャット + 引用
6. **Segments** — 動的リスト
7. **Settings** — 連携、ICP 定義、モデル/予算、メンバー、監査ログ

## 7. i18n / マルチテナンシー（外販前提の初期要件）

- 全 UI 文字列をリソース化（`next-intl`）。ja/en を出荷
- **シグナル検出・文面生成がマルチリンガル対応**（日本語ビジネスメールの文体生成は競合が弱い点）
- Organization 単位のデータ分離を Postgres RLS で最初から入れる
- 認証: メール+OAuth（社内はGoogle Workspace）。外販時に SSO/SCIM 追加できる設計

## 8. 非機能要件（内部→外販）

| 項目 | 社内フェーズ | 外販フェーズ |
|---|---|---|
| データ分離 | 単一 org | RLS + tenant キー必須 |
| 監査 | run/action ログ保持 | export 可能な audit trail |
| 送信安全性 | 全承認制 | 承認ポリシーを org 設定化 |
| モデル | API キーは env | org 毎 BYOK or 従量課金 |
| 課金 | — | seat + run 従量のハイブリッド想定 |
