-- =============================================================================
-- daily_shadow_summary ビュー
--
-- SHADOWモードの入札提案を日次単位で集約し、
-- 「当たり/外れ率」を把握するためのビュー。
--
-- ソースビュー:
--   - shadow_eval_keyword_7d（SHADOWモード評価ビュー）
--
-- 用途:
--   - 日単位でのSHADOW提案の精度を俯瞰
--   - 外れ率が高い日の特定
--   - AI分析用のサマリーデータ生成
-- =============================================================================

CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.daily_shadow_summary` AS

SELECT
  -- 日付（recommended_at から DATE 抽出）
  DATE(recommended_at) AS date,

  -- shadow_executions: 当該日のSHADOWモード実行回数（DISTINCT execution_id）
  COUNT(DISTINCT execution_id) AS shadow_executions,

  -- total_recommendations: 評価対象となった提案件数
  COUNT(*) AS total_recommendations,

  -- bad_recommendations: was_good_decision = FALSE の件数
  COUNTIF(was_good_decision = FALSE) AS bad_recommendations,

  -- bad_rate: bad_recommendations / total_recommendations
  -- SAFE_DIVIDE を使用してゼロ除算を防止
  SAFE_DIVIDE(
    COUNTIF(was_good_decision = FALSE),
    COUNT(*)
  ) AS bad_rate

FROM `${PROJECT_ID}.${DATASET}.shadow_eval_keyword_7d`

-- 直近30日分のみを対象（パフォーマンス考慮）
WHERE DATE(recommended_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)

-- 日付でグループ化
GROUP BY DATE(recommended_at)

-- 新しい日付順にソート
ORDER BY date DESC;

-- =============================================================================
-- カラム説明:
--
-- | カラム名                | 型       | 説明                                      |
-- |------------------------|----------|------------------------------------------|
-- | date                   | DATE     | SHADOW提案の評価対象日                      |
-- | shadow_executions      | INT64    | 当該日のSHADOWモード実行回数（ユニーク）      |
-- | total_recommendations  | INT64    | 評価対象となった提案件数                     |
-- | bad_recommendations    | INT64    | was_good_decision = FALSE の件数           |
-- | bad_rate               | FLOAT64  | 外れ率（0〜1）                              |
--
-- =============================================================================
-- 使用例:
--
-- 1. 直近の日次サマリーを確認
--    SELECT * FROM daily_shadow_summary LIMIT 10;
--
-- 2. 外れ率が40%以上の日を抽出
--    SELECT * FROM daily_shadow_summary WHERE bad_rate >= 0.4;
--
-- 3. 過去1週間の平均外れ率を算出
--    SELECT AVG(bad_rate) AS avg_bad_rate
--    FROM daily_shadow_summary
--    WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY);
--
-- =============================================================================
