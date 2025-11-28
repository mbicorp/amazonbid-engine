/**
 * ヘルスチェック・ルートインデックス
 */

import { Router, Request, Response } from "express";
import { getAllCircuitBreakerStatuses } from "../utils/retry";

const router = Router();

// ルート一覧
router.get("/", (_req: Request, res: Response) => {
  return res.json({
    message: "Amazon Bid Engine API",
    version: "1.0.0",
    endpoints: {
      health: "GET /health",
      recommend: "POST /recommend",
      cron_run: "POST /cron/run",
      cron_run_normal: "POST /cron/run-normal",
      cron_run_smode: "POST /cron/run-smode",
      escore_optimize: "POST /escore/optimize",
      escore_stats: "GET /escore/stats",
      escore_health: "GET /escore/health",
      jungle_scout_sync: "POST /jungle-scout/sync",
      jungle_scout_analyze: "POST /jungle-scout/analyze",
      jungle_scout_keywords: "GET /jungle-scout/keywords/:asin",
      jungle_scout_sov: "GET /jungle-scout/sov/:asin",
      jungle_scout_strategy: "GET /jungle-scout/strategy/:asin",
      jungle_scout_trending: "GET /jungle-scout/trending",
      unified_calculate: "POST /unified/calculate",
      unified_product: "POST /unified/product",
      unified_strategy: "GET /unified/strategy/:asin",
      unified_summary: "GET /unified/summary/:asin",
      seo_investment_evaluate: "POST /seo-investment/evaluate",
      seo_investment_status: "GET /seo-investment/status/:asin",
      seo_investment_update: "POST /seo-investment/update",
      seo_investment_summary: "GET /seo-investment/summary/:asin",
    },
  });
});

// ヘルスチェック
router.get("/health", (_req: Request, res: Response) => {
  const circuitBreakers = getAllCircuitBreakerStatuses();
  const cbStatus: Record<string, { state: string; failures: number }> = {};

  circuitBreakers.forEach((status, name) => {
    cbStatus[name] = status;
  });

  const hasOpenCircuit = Array.from(circuitBreakers.values()).some(
    (cb) => cb.state === "OPEN"
  );

  return res.status(hasOpenCircuit ? 503 : 200).json({
    status: hasOpenCircuit ? "degraded" : "healthy",
    timestamp: new Date().toISOString(),
    circuitBreakers: cbStatus,
  });
});

export default router;
