# 競合ランドスケープ — AI GTM エージェント領域

## 1. カテゴリマップ

```
                    実行/送信に強い
                         │
   Unify ────────┐       │        ┌──── 11x / Artisan (AI SDR)
                 │       │        │
 データ源に強い ──┼───────┼────────┼── 浅い ←→ 深いエージェント自律性
                 │       │        │
   Clay ─────────┘       │        └──── Regie.ai / AiSDR
                         │
   Common Room ──── Avina / SyncGTM
                         │
                    シグナル検知に強い
```

実際の棲み分け（2026 時点の第三者評価ベース）:

| 製品 | カテゴリ | 強み | 弱み | 価格感 |
|---|---|---|---|---|
| **Clay** | データオーケストレーション | 150+ ソース、waterfall エンリッチ、Claygent | 「作業台」であって実行系ではない。ワークフロー設計が要る | $149/月〜 |
| **Unify** | signal-to-action outbound | シグナル→シーケンスが1製品で閉じる | シグナル網は狭い、email 中心、エンタープライズは高い | ~$500/月〜、seat $20-60 |
| **Common Room** | バイヤーシグナル/コミュニティ | 50+ シグナル源、Person360 の人物解決、RoomieAI | 高い (Essential $2,500/月〜)、中〜大企業向き | $500〜$2,500/月〜 |
| **UserGems** | champion/リレーションシグナル | champion 異動追跡の老舗 | 高い (Core $40k/年〜) | $40k/年〜 |
| **Apollo** | DB+シーケンサー | 270M contacts、安い、DBから送信まで一体 | シグナルオーケストレーションは浅い | $49/月〜 |
| **11x (Alice)** | 自律 AI SDR | 「雇用するAI」としての完成度訴求 | 高額・ブラックボックス・品質議論あり | enterprise |
| **Regie.ai / AiSDR** | AI SDR パッケージ | 送信インフラ込み | カスタムシグナル設計は弱い | 中〜高 |
| **Demandbase / 6sense** | エンタープライズ ABM | サードパーティ intent の網羅性 | 重い・高い・実装が要る | custom |
| **Avina / SyncGTM** | 新興 signal-to-action | 安い・モダン | 実績浅い | $99-259/月 |
| **Attio / Day.ai / Twenty(OSS)** | AI-native CRM | SoR 自体を AI 前提で再設計 | エージェント実行系ではない | $0-29/seat |

**Frontrunner の位置**: Clay の「カスタムシグナル設計」× Unify の「signal→action」× Cursor の「委任UI」。SoR は持たず既存スタックに乗る overlay。

## 2. 我々の差別化軸（10x の設計要求に直結）

| 軸 | 既存の限界 | 我々の打ち手 |
|---|---|---|
| **SoR** | 全員 Salesforce/HubSpot 前提 or 連携必要 | **アプリケーション層ごと作る**（ユーザー方針）。CRM/受信トレイ/送信を内製し AI-native に。連携はオプション |
| **言語/市場** | 全員英語・USデータソース | **日英 i18n を最初から** + 日本のシグナル源（TDnet適時開示、PR TIMES、Wantedly/求人票、帝国データバンク系、日経） |
| **参入摩擦** | demo-gated か高額 | **self-serve** で内部利用→外販へそのまま繋ぐ |
| **信頼性** | エージェント品質がブラックボックス | **eval/監査をファーストクラス**に：run の採点、差分レビュー、dry-run、差し戻し可能な書き戻し |
| **コンテキスト** | "compound" を謳うが形が不明 | run の出力を**知識グラフに構造化還元**（出典 provenance 付き）。Ask が引用付きで答える |
| **エージェント形式** | プロプライエタリ・UI内完結 | **宣言的エージェント spec**（YAML/Markdown）で Git 管理可能。社内ではエンジニアが直書きもできる |
| **モデル** | 各社ロックイン傾向 | mixture-of-models を踏襲しつつ、**step ごとの cost/latency budget と eval スコアでルーティング** |

## 3. 参考にすべき隣接プロダクト

- **Day.ai / Attio** — AI-native CRM の SoR 設計（calls/email/calendar から自動構築）→ 我々のアプリ層の範
- **Clay の table モデル** — 「シグナル→列、エージェント→列の計算」というメンタルモデルは強い
- **Composio / Arcade** — ツール接続を自前で全部書かないためのコネクタ基盤（OSS 活用方針と合致）
- **Temporal / Inngest / Trigger.dev** — 長時間エージェント実行の durable execution
- **Langfuse / Braintrust** — エージェント run の eval・トレース基盤（内製 or 組込）

## 4. 脅威とタイミング

- Clay/Unify/Frontrunner 全員「agent 化」に収束中 → 窓は 12-18ヶ月
- ただし全員 **US・英語・既存CRM前提**。日本語圏 + SoR内製の組合せは構造的に誰も取れない位置
- 社内利用で実績（= 最強の case study）を作ってから外販、は正攻法として妥当
