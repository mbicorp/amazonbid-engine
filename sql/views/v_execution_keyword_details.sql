-- =============================================================================
-- v_execution_keyword_details
--
-- execution_id ごとのキーワード詳細ビュー
-- BigQueryに手動でデプロイして使用
-- =============================================================================

CREATE OR REPLACE VIEW `${PROJECT_ID}.amazon_bid_engine.v_execution_keyword_details` AS
SELECT
  -- 実行情報
  e.execution_id,
  e.profile_id,
  e.execution_type,
  e.mode,
  e.started_at,
  e.status AS execution_status,

  -- キーワード情報
  br.keyword_id,
  br.keyword_text,
  br.match_type,
  br.campaign_id,
  br.ad_group_id,
  br.asin,
  br.lifecycle_state,

  -- 入札情報
  br.current_bid,
  br.recommended_bid,
  br.bid_change,
  br.bid_change_ratio,
  br.target_acos,

  -- 理由コード
  br.reason_codes,

  -- パフォーマンス指標
  br.impressions,
  br.clicks,
  br.orders,
  br.sales,
  br.cost,
  br.cvr,
  br.acos,

  -- AUTO→EXACT昇格候補フラグ
  CASE
    WHEN aeps.keyword_id IS NOT NULL THEN TRUE
    ELSE FALSE
  END AS is_auto_exact_candidate,

  -- AUTO→EXACT詳細情報（候補の場合）
  aeps.suggested_exact_keyword,
  aeps.confidence_score AS auto_exact_confidence,
  aeps.reason AS auto_exact_reason,

  -- レコード作成日時
  br.created_at

FROM
  `${PROJECT_ID}.amazon_bid_engine.executions` e
INNER JOIN
  `${PROJECT_ID}.amazon_bid_engine.bid_recommendations` br
  ON e.execution_id = br.execution_id
LEFT JOIN
  `${PROJECT_ID}.amazon_bid_engine.auto_exact_promotion_suggestions` aeps
  ON br.execution_id = aeps.execution_id
  AND br.keyword_id = aeps.source_keyword_id

ORDER BY
  e.started_at DESC,
  br.asin,
  br.keyword_text;


-- =============================================================================
-- 使用例
-- =============================================================================
--
-- 1. 特定の実行のキーワード詳細を取得:
--    SELECT * FROM `project.amazon_bid_engine.v_execution_keyword_details`
--    WHERE execution_id = 'xxx-yyy-zzz'
--    ORDER BY bid_change_ratio DESC;
--
-- 2. AUTO→EXACT候補のみ取得:
--    SELECT * FROM `project.amazon_bid_engine.v_execution_keyword_details`
--    WHERE execution_id = 'xxx-yyy-zzz'
--    AND is_auto_exact_candidate = TRUE
--    ORDER BY auto_exact_confidence DESC;
--
-- 3. 特定ASINのキーワード詳細:
--    SELECT * FROM `project.amazon_bid_engine.v_execution_keyword_details`
--    WHERE execution_id = 'xxx-yyy-zzz'
--    AND asin = 'B0XXXXXXXXX';
--
-- 4. 入札引き上げ対象のキーワード:
--    SELECT * FROM `project.amazon_bid_engine.v_execution_keyword_details`
--    WHERE execution_id = 'xxx-yyy-zzz'
--    AND bid_change > 0
--    ORDER BY bid_change DESC;
--
-- 5. ライフサイクル状態別の集計:
--    SELECT
--      lifecycle_state,
--      COUNT(*) as keyword_count,
--      AVG(bid_change_ratio) as avg_change_ratio
--    FROM `project.amazon_bid_engine.v_execution_keyword_details`
--    WHERE execution_id = 'xxx-yyy-zzz'
--    GROUP BY lifecycle_state;
-- =============================================================================
