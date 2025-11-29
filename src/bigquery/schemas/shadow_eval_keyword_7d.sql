-- =============================================================================
-- SHADOW評価ビュー（キーワード単位・7日間）
--
-- SHADOWモードで提案された入札値と、その期間の実績を比較し、
-- 提案の妥当性を事後検証するためのビュー。
--
-- ソーステーブル:
--   - keyword_recommendations_log（SHADOWモードの推奨入札ログ）
--   - keyword_metrics_7d（キーワード実績指標ビュー）
--   - product_config（商品設定 - ライフサイクル情報）
--
-- 用途:
--   - SHADOWモードの入札提案と実績の乖離を確認
--   - 「提案が正しかったか」を判定し、ロジック改善に活用
-- =============================================================================

CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.shadow_eval_keyword_7d` AS

WITH
  -- 直近7日間のSHADOWモード推奨を取得
  shadow_recommendations AS (
    SELECT
      kr.execution_id,
      kr.asin,
      kr.campaign_id,
      kr.ad_group_id,
      kr.keyword_id,
      kr.keyword_text,
      kr.match_type,
      kr.old_bid AS bid_actual,
      kr.new_bid AS bid_recommended,
      kr.bid_change,
      kr.bid_change_percent,
      kr.target_acos,
      kr.current_acos AS acos_at_recommendation,
      kr.reason_code,
      kr.lifecycle_state,
      kr.impressions_7d AS impressions_at_reco,
      kr.clicks_7d AS clicks_at_reco,
      kr.conversions_7d AS orders_at_reco,
      kr.sales_7d AS sales_at_reco,
      kr.spend_7d AS cost_at_reco,
      kr.recommended_at,
      -- 推奨方向を判定
      CASE
        WHEN kr.bid_change > 0 THEN 'UP'
        WHEN kr.bid_change < 0 THEN 'DOWN'
        ELSE 'KEEP'
      END AS direction
    FROM `${PROJECT_ID}.${DATASET}.keyword_recommendations_log` kr
    WHERE
      -- SHADOWモードのみ（適用されていない推奨）
      kr.is_applied = FALSE
      -- 直近7日間に絞る
      AND DATE(kr.recommended_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
      -- mode カラムがある場合は使用、ない場合は is_applied = FALSE で判定
      -- (既存のログにmodeカラムがあれば: AND kr.guardrails_mode IS NOT NULL)
  ),

  -- 現在のキーワード実績を取得
  current_metrics AS (
    SELECT
      km.asin,
      km.keyword_text,
      km.match_type,
      km.campaign_id,
      km.ad_group_id,
      km.impressions_7d,
      km.clicks_7d,
      km.orders_7d,
      km.sales_7d,
      km.cost_7d,
      km.acos_7d,
      km.cvr_7d,
      km.current_bid
    FROM `${PROJECT_ID}.${DATASET}.keyword_metrics_7d` km
  ),

  -- 商品のライフサイクル情報を取得
  product_info AS (
    SELECT
      pc.asin,
      pc.lifecycle_stage,
      pc.target_acos AS product_target_acos
    FROM `${PROJECT_ID}.${DATASET}.product_config` pc
    WHERE pc.is_active = TRUE
  )

SELECT
  sr.execution_id,
  'SHADOW' AS mode,
  sr.asin,
  sr.campaign_id,
  sr.ad_group_id,
  sr.keyword_id,
  sr.keyword_text,
  sr.match_type,

  -- 入札情報
  sr.bid_recommended,
  sr.bid_actual,
  (sr.bid_recommended - sr.bid_actual) AS bid_gap,
  SAFE_DIVIDE(sr.bid_recommended - sr.bid_actual, NULLIF(sr.bid_actual, 0)) AS bid_gap_rate,

  -- 実績指標（現在）
  COALESCE(cm.clicks_7d, 0) AS clicks,
  COALESCE(cm.orders_7d, 0) AS orders,
  COALESCE(cm.sales_7d, 0) AS sales,
  COALESCE(cm.cost_7d, 0) AS cost,
  cm.acos_7d AS acos,
  -- TACOS計算（広告費 / 総売上）- ここでは acos を代用
  cm.acos_7d AS tacos,
  -- 利益相当指標（売上 - 広告費）
  COALESCE(cm.sales_7d, 0) - COALESCE(cm.cost_7d, 0) AS net_profit,

  -- 推奨方向
  sr.direction,

  -- ライフサイクル情報
  COALESCE(pi.lifecycle_stage, sr.lifecycle_state) AS lifecycle_stage,

  -- =============================================================================
  -- was_good_decision の判定ロジック
  --
  -- 【暫定閾値】これらの閾値は docs/bid_core.md の backtest ロジックと整合する
  -- 値に寄せており、実運用データを見て調整が必要
  --
  -- UP提案の場合:
  --   - 売上が10%以上増加、または
  --   - ACOSがtarget_acos以下に改善
  --   → 「入札を上げるべき」という提案が正しかった
  --
  -- DOWN提案の場合:
  --   - 広告費が10%以上削減、または
  --   - ACOSが10%以上改善（低下）
  --   → 「入札を下げるべき」という提案が正しかった
  --
  -- KEEP提案の場合:
  --   - ACOSの変動が±15%以内
  --   → 「変更不要」という提案が正しかった
  -- =============================================================================
  CASE
    -- UP提案の評価
    WHEN sr.direction = 'UP' THEN
      CASE
        -- 売上が増加傾向、または ACOS が目標以下なら良い判定
        WHEN COALESCE(cm.sales_7d, 0) > COALESCE(sr.sales_at_reco, 0) * 1.10 THEN TRUE
        WHEN cm.acos_7d IS NOT NULL
             AND sr.target_acos IS NOT NULL
             AND cm.acos_7d <= sr.target_acos THEN TRUE
        ELSE FALSE
      END

    -- DOWN提案の評価
    WHEN sr.direction = 'DOWN' THEN
      CASE
        -- 広告費削減、または ACOS 改善なら良い判定
        WHEN COALESCE(cm.cost_7d, 0) < COALESCE(sr.cost_at_reco, 0) * 0.90 THEN TRUE
        WHEN cm.acos_7d IS NOT NULL
             AND sr.acos_at_recommendation IS NOT NULL
             AND cm.acos_7d < sr.acos_at_recommendation * 0.90 THEN TRUE
        -- 注: DOWNは「広告費抑制が目的」なので、売上減少は許容される場合がある
        ELSE FALSE
      END

    -- KEEP提案の評価
    WHEN sr.direction = 'KEEP' THEN
      CASE
        -- ACOS変動が±15%以内なら「変更不要」は正しかった
        WHEN cm.acos_7d IS NULL OR sr.acos_at_recommendation IS NULL THEN TRUE
        WHEN ABS(cm.acos_7d - sr.acos_at_recommendation) / NULLIF(sr.acos_at_recommendation, 0) <= 0.15 THEN TRUE
        ELSE FALSE
      END

    -- その他（念のため）
    ELSE NULL
  END AS was_good_decision,

  -- 推奨時の情報（デバッグ用）
  sr.reason_code,
  sr.target_acos,
  sr.recommended_at

FROM shadow_recommendations sr
LEFT JOIN current_metrics cm
  ON sr.asin = cm.asin
  AND sr.keyword_text = cm.keyword_text
  AND sr.match_type = cm.match_type
  AND sr.campaign_id = cm.campaign_id
  AND sr.ad_group_id = cm.ad_group_id
LEFT JOIN product_info pi
  ON sr.asin = pi.asin

-- 最新の推奨を優先（同一キーワードに複数推奨がある場合）
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY sr.asin, sr.keyword_text, sr.match_type, sr.campaign_id, sr.ad_group_id
  ORDER BY sr.recommended_at DESC
) = 1;

-- =============================================================================
-- 使用例:
--
-- 1. 全SHADOW評価を確認
--    SELECT * FROM shadow_eval_keyword_7d LIMIT 100;
--
-- 2. 提案が外れたケースを抽出
--    SELECT * FROM shadow_eval_keyword_7d WHERE was_good_decision = FALSE;
--
-- 3. 方向別の精度を集計
--    SELECT
--      direction,
--      COUNTIF(was_good_decision) AS good_count,
--      COUNT(*) AS total,
--      SAFE_DIVIDE(COUNTIF(was_good_decision), COUNT(*)) AS accuracy
--    FROM shadow_eval_keyword_7d
--    GROUP BY direction;
--
-- =============================================================================
