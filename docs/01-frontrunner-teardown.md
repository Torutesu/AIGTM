# Frontrunner (usefr.com) 徹底調査 — Teardown

調査日: 2026-09-14 / 手法: サイト HTML・JS バンドル全抽出、YC プロフィール、第三者レビュー

---

## 1. 会社概要

| 項目 | 内容 |
|---|---|
| 製品名 | Frontrunner |
| キャッチ | "Cursor for GTM" → サイト上では "AI operating system for GTM teams" |
| URL | https://usefr.com/ |
| YC | Fall 2026 バッチ (F26) |
| 所在地 | San Francisco |
| チーム | 2名 |
| 創業者 | Maya Nayyar (CEO) — 元 Head of Growth @Console、Growth Lead @Encord (YC W21)、BoA 出身、Columbia 経済<br>Carl Bager (CTO) — 元 CEO @Diciv (Madison AI に買収)、Growth Eng Lead @Encord、Instawork (S15)、The Org、Yale |
| 採用 | YC 上で募集ポジションなし |
| 連絡先 | founders@usefr.com (Book a demo → メール) |
| SNS | LinkedIn /company/frontrunnerai、Instagram/Twitter @frontrunnerai |

**読み**: グロース畑の2人組。「GTM エンジニアリングをプロダクト化する」発想。Encord で growth engineering をやっていた経験がそのまま製品仮説。

## 2. ポジショニングとメッセージ

ヒーロー: **"AI agents for GTM"**。サブ: "Connects your GTM stack, gives agents the context to act, and keeps your team running in the same direction."

「Cursor for GTM」という比喩が核心:
- Cursor = IDE の中で AI がコードを書く → Frontrunner = GTM スタックの中で AI が営業作業をする
- 「エディタにタブが増える」のではなく「エージェントに仕事を委任する」
- "revenue factory" という語を繰り返し使う（工場のラインを回し続ける比喩）
- ロゴ/モチーフは**馬**（Muybridge の連続写真「走る馬」を canvas アニメーション化）。frontrunner = 先頭の馬

サイト構成 (1ページ LP + /agents /signals /demo /privacy /tos):
1. Hero — "AI agents for GTM" + Askバー風デモ (自然言語クエリ → 結果)
2. **"Automate the entire revenue cycle"** — prospecting, account research, inbound qualification, lifecycle, CRM hygiene, account management, reporting
3. **"Engineer custom signals relevant to your business"** — シグナルカタログ (後述)
4. **"Describe a task once and delegate it forever"** — エージェント委任
5. **"Fits into how your team already works"** — 4つのサブ訴求:
   - Connect your existing tools
   - Engineer custom signals
   - Compound every agent run ("Every run creates more context, strengthens your workflows, and makes the next run better")
   - See what's driving revenue (first touch → pipeline → revenue のアトリビューション)
6. **"Every tool your GTM already runs on"** — 連携ロゴ群
7. **"Frontrunner routes each step to the model it needs"** — mixture-of-agents / multi-model orchestration
8. **"Context supremacy"** — "one shared context so your team and agents can work from the same understanding"
9. CTA — Book a demo / founders@usefr.com

## 3. 製品サーフェス（バンドルから復元したUI構造）

アプリ内ナビ: **Workspace / Agents / Signals / Segments / Contacts / Runs / Logs / Favorites**

2つのモード:
- **Assistant mode** — 人が聞く。Ask バーに自然言語で質問 → GTMコンテキスト横断で回答
  - 例: "Which of our target accounts announced a new head of sales or RevOps in the last 30 days, and who here knows them?"
- **Agent mode** — エージェントが動く。"Describe the agent you want..." / "Describe the task you want to delegate..." でエージェント生成

エージェントのトリガー種別: **Manual / Schedule / Event** (ラベル確認済み)

ラン表示のフィールド例: Latest signal / Last touch / ICP フラグ / ステータス (fulfilled/rejected)

## 4. シグナルカタログ（完全抽出 — ここが本質）

シグナル名 → カテゴリ → 説明文の対応表:

| シグナル | カテゴリ | 説明 (原文) |
|---|---|---|
| Registry trace | Intent | Reads company filings and traces the accounting system from them. Stages every company in the size band that runs the ledger you sell into. |
| First GTM hire | Hiring | Watches job boards for the first GTM engineer, growth or RevOps hire at a company with no prior GTM headcount. |
| Champion moves | Champions | Follows past buyers and champions to their next role. Flags the day they land somewhere in your ICP. |
| Pricing page visits | Intent | Resolves identified visitors on pricing and product pages to accounts. Counts people per office, not hits. |
| RevOps hires | Hiring | Finds the first RevOps or sales ops lead, the moment a team starts to systematise. |
| Funding rounds | Growth | Catches announced and quiet rounds, then checks the hiring plan that follows. |
| Conference attendees | Events | Matches speaker and attendee lists to accounts and ICP roles before the event opens. |
| Repo watchers | Engagement | Judges stargazers and watchers of monitored repos against the ICP and resolves their companies. |
| Reply monitor | Engagement | Reads replies across sequencers and inboxes and classifies intent, so a hot one never waits. |
| Stalled deals | Engagement | Flags deals with no activity in 14 days and the reason the last thread went quiet. |

その他のシグナル種別ラベル: `Headcount growth` `New office` `Job posting language` `Tech stack change` `G2 review` `Podcast guest` `Event` `Partner mention` `Competitor churn` `Bespoke signals`

シグナルの実例 (フィードに出るイベント文面):
- "Job posting: RevOps lead, first in the company" / "first RevOps role at the company, 44"
- "Headcount +18% in 90 days, 6 sales roles open"
- "Demo request via /demo, routed in 3 min"
- "3 people on /pricing and /agents this week" (RB2B で個人特定)
- "Past champion now VP Marketing, warm intro drafted"
- "SaaStr Annual: 2 attendees in ICP roles"
- "No reply in 14 days, recovery drafted"
- "Lookalike of a closed-won account, fit 82"
- "Opened 4 of 5 emails, clicked the case study"

**設計上の本質**: シグナルは「定義 → 継続評価 → アカウント解決 → ICP適合判定 → アクションへ橋渡し」のパイプ。検出だけでなく **entity resolution（会社/人への紐付け）と ICP 採点までがシグナルの定義に含まれる**。

## 5. エージェントライブラリ（全19種、名称抽出済み）

| エージェント | やること（推定/抽出文） |
|---|---|
| Auto-prospecting | 自動 prospecting。lookalike 探索 → CRM dedupe → outreach へ |
| Lookalike Prospecting | closed-won の類似企業を採点 (fit 79/82 など) |
| Champion Re-activation | 過去の champion の異動追跡 → warm intro 起案 |
| Website Visitor Outreach | /pricing 等の訪問者をアカウント解決 → outreach |
| Hand-raiser Routing | フォーム入力/チャットを ICP 採点 → 1分以内に owner/nurture へルーティング |
| Inbound SLA Routing | inbound の SLA タイマー付きルーティング |
| SDR Daily Prioritization | SDR の今日の優先リスト |
| Meeting Prep | 直前ミーティングの prep brief (deal context 付き) |
| Pipeline Reviewer | "open deals, 212" → MEDDPICC で1件ずつ reasoning pass → next action |
| Stalled Deal Recovery | 14日無活動ディール検出 → 滞留理由 → recovery note 起案 |
| Renewal Radar | 更新検知。"competitor logo leaving a customer page or a renewal that did not happen" |
| Reply Monitor | 返信の意図分類 (12 positive, 9 later, 63 no / 63 sequences stopped) |
| Churn Signals | チャーン兆候検知 |
| Case Study Miner | ケーススタディ化できる顧客の発掘 |
| Conference Follow-up | イベント参加者照合 → follow-up 起案 |
| Partner Referral Intake | パートナー紹介の受付・採点 |
| Territory Assignment | territory/owner ルール適用 ("owner per account, 12 of 12") |
| Weekly Pipeline Digest | #gtm に delta を投稿 |
| (Competitor churn) | 競合離脱の検知 |

エージェントランの内部ステップ例（文章として抽出）:
- "Check for an existing customer or open opportunity"
- "Evaluate routing rules against the account"
- "Grade the lead against ICP and resolve disposition"
- "Fetch the rep's meetings and enrich with deal context"
- "Evaluate each deal on MEDDPICC with a dedicated reasoning pass"
- "Find lookalikes and dedupe against the CRM"
- "Draft the follow-up per person and hold it for the owner"
- "Draft a recovery note from the last call and the business logic"

→ **各ステップが LLM reasoning + ツール呼出しのチェイン**。人間への手渡しは「hold for the owner」= 承認ゲートが組み込み済み。

## 6. 連携（ロゴ＋説明文を抽出、カテゴリ別）

- **CRM / SoR**: Salesforce, HubSpot, Attio, Day.ai ("AI-native CRM built from calls, email and calendar" と明記), Airtable
- **会話/知識**: Slack ("Agents read threads for context and post briefs"), Gong ("Call transcripts and deal context"), Fireflies, Notion ("Knowledge base"), Google Workspace, Granola 系は無し
- **エンリッチ/データ**: Clay ("Enrichment and search on your Clay account" — Clay は競合でなく連携先), Apollo ("Contact data"), Coresignal ("Headcount, hiring and firmographic data"), LinkedIn Sales Navigator, RB2B (visitor ID)
- **送信/シーケンサー**: Instantly ("Cold email sending, warm-up and deliverability"), HeyReach ("LinkedIn outreach across sender seats"), Outreach, Salesloft
- **その他**: Intercom, Snowflake, PostHog, Zapier, Calendly
- **モデルプロバイダ表記**: Anthropic, OpenAI, Google, Perplexity

## 7. アーキテクチャ推定

- LP: React SPA (Vite/rolldown ビルド), Tailwind, Lenis smooth scroll, canvas アニメーション、Google favicon API で連携ロゴ取得
- トラッカー: RB2B を自社サイトに設置（dogfooding — pricing page visits シグナルのデモになっている）
- 製品側: "mixture-of-agents and multi-model orchestration harness" と明記。モデル非依存、ステップ単位でルーティング
- 「no single tool or provider is a dependency」= 既存スタックの上に乗る overlay 戦略。**自社では SoR を持たない**（ここが我々の10xの隙）

## 8. ビジネスモデル

- 完全 demo-gated（self-serve signup なし、価格非公開）
- 2名チームのため high-touch 販売 + 設計支援モデルと推定
- ターゲット: AI/開発者系 B2B のシード〜シリーズB あたり（例が全部その手の会社）

## 9. 弱み・隙（10x の根拠）

1. **SoR を持たない** — Salesforce/HubSpot が前提。CRM 未整備 or AI-native な SoR を欲する企業には届かない。連携セットアップの摩擦が大きい
2. **demo-gated・英語のみ・USデータソース中心** — 日本市場は素通り
3. **2名チーム** — 実装深度・サポートに限界
4. エージェントの**評価(eval)・品質保証の仕組みが見えない** — "compound" は謳うが run 品質の計測面は不明
5. 承認ゲートはあるが、**書き戻しの安全性（dry-run/差し戻し/監査）の訴求が薄い**
6. 価格非公開 — おそらく高い。self-serve 低価格帯は空き

## 10. クローン時に必須のコアループ（最小定義）

```
Connect (取込) → Context (統合コンテキスト) → Signal (定義+継続評価)
→ Agent Run (multi-step, model-routed) → Approval (人間ゲート)
→ Action (書き戻し/送信) → Learn (run がコンテキストに還元)
```

このループを壊さず再実装するのが「クローン」。そこに「SoR 自体もAI-nativeで作る」が乗ると 10x。
