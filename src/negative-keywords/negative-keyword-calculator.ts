/**
 * ネガティブキーワード候補計算
 *
 * 統計的に安全な方法でネガティブキーワード候補をサジェストします。
 * SHADOWモード専用で、自動でのネガティブ登録は行いません。
 */

import { BigQuery } from "@google-cloud/bigquery";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger";
import { ExecutionMode } from "../logging/types";
import { ProductConfig, LifecycleState } from "../ltv/types";
import {
  NegativeKeywordCandidate,
  NegativeSuggestConfig,
  NegativeKeywordCandidatesResult,
  SearchTermStats30dRow,
  IntentClusterStats30dRow,
  NegativeKeywordSuggestionRow,
  NegativeReasonCode,
  QueryRole,
  NegativeMatchType,
  DEFAULT_NEGATIVE_SUGGEST_CONFIG,
  isExcludedLifecycleState,
} from "./types";
import { SalePhase } from "../tacos-acos/types";
import {
  KeywordRole,
  PresaleType,
  LossBudgetState,
  GuardrailContext,
  RoleLifecycleGuardrails,
  getRoleLifecycleGuardrails,
  computeOverspendRatio,
  meetsActionThreshold,
} from "../engine/roleGuardrails";

// =============================================================================
// BigQueryクライアント
// =============================================================================

let bigqueryClient: BigQuery | null = null;

function getBigQueryClient(): BigQuery {
  if (!bigqueryClient) {
    bigqueryClient = new BigQuery();
  }
  return bigqueryClient;
}

// =============================================================================
// データ取得関数
// =============================================================================

/**
 * ASIN全体のベースラインCVRを計算
 */
async function fetchBaselineAsinCvr(
  projectId: string,
  dataset: string,
  asin: string,
  minimumBaselineCvr: number
): Promise<{ cvr: number; totalClicks: number; totalConversions: number }> {
  const bq = getBigQueryClient();

  const query = `
    SELECT
      SUM(clicks_30d) AS total_clicks,
      SUM(conversions_30d) AS total_conversions
    FROM \`${projectId}.${dataset}.search_term_stats_30d\`
    WHERE asin = @asin
  `;

  const [rows] = await bq.query({
    query,
    params: { asin },
  });

  const row = rows[0] || { total_clicks: 0, total_conversions: 0 };
  const totalClicks = Number(row.total_clicks) || 0;
  const totalConversions = Number(row.total_conversions) || 0;

  // CVRを計算（クリックが少ない場合は最小ベースラインを使用）
  let cvr = totalClicks > 0 ? totalConversions / totalClicks : 0;
  cvr = Math.max(cvr, minimumBaselineCvr);

  return { cvr, totalClicks, totalConversions };
}

/**
 * 検索クエリ統計を取得
 */
async function fetchSearchTermStats(
  projectId: string,
  dataset: string,
  asin: string
): Promise<SearchTermStats30dRow[]> {
  const bq = getBigQueryClient();

  const query = `
    SELECT
      asin,
      query,
      match_type,
      intent_cluster_id,
      impressions_30d,
      clicks_30d,
      cost_30d,
      conversions_30d,
      revenue_30d,
      cpc_30d,
      cvr_30d,
      acos_30d
    FROM \`${projectId}.${dataset}.search_term_stats_30d\`
    WHERE asin = @asin
  `;

  const [rows] = await bq.query({
    query,
    params: { asin },
  });

  return rows as SearchTermStats30dRow[];
}

/**
 * クラスタ統計を取得
 */
async function fetchClusterStats(
  projectId: string,
  dataset: string,
  asin: string
): Promise<Map<string, IntentClusterStats30dRow>> {
  const bq = getBigQueryClient();

  const query = `
    SELECT
      asin,
      intent_cluster_id,
      cluster_impressions_30d,
      cluster_clicks_30d,
      cluster_cost_30d,
      cluster_conversions_30d,
      cluster_revenue_30d,
      cluster_cpc_30d,
      cluster_cvr_30d,
      cluster_acos_30d,
      queries_in_cluster
    FROM \`${projectId}.${dataset}.intent_cluster_stats_30d\`
    WHERE asin = @asin
  `;

  const [rows] = await bq.query({
    query,
    params: { asin },
  });

  const map = new Map<string, IntentClusterStats30dRow>();
  for (const row of rows as IntentClusterStats30dRow[]) {
    map.set(row.intent_cluster_id, row);
  }

  return map;
}

/**
 * ASIN全体の平均CPCを取得
 */
async function fetchAverageAsinCpc(
  projectId: string,
  dataset: string,
  asin: string
): Promise<number> {
  const bq = getBigQueryClient();

  const query = `
    SELECT
      SAFE_DIVIDE(SUM(cost_30d), SUM(clicks_30d)) AS avg_cpc
    FROM \`${projectId}.${dataset}.search_term_stats_30d\`
    WHERE asin = @asin AND clicks_30d > 0
  `;

  const [rows] = await bq.query({
    query,
    params: { asin },
  });

  return Number(rows[0]?.avg_cpc) || 0;
}

// =============================================================================
// ヘルパー関数
// =============================================================================

/**
 * ルールオブスリーによる必要クリック数を計算
 *
 * CVR=0のとき、95％信頼上限のCVRは 3/N と近似できる
 * requiredClicks = ceil(3 / (baselineAsinCvr * riskTolerance))
 */
function calculateRequiredClicks(
  baselineCvr: number,
  riskTolerance: number
): number {
  if (baselineCvr <= 0 || riskTolerance <= 0) {
    return 100; // フォールバック値
  }
  return Math.ceil(3 / (baselineCvr * riskTolerance));
}

/**
 * クエリの役割を判定
 */
function determineQueryRole(
  query: string,
  productConfig: ProductConfig
): QueryRole {
  const lowerQuery = query.toLowerCase();

  // ブランドキーワードのチェック（product_configにbrand_keywordsがある場合）
  // TODO: ProductConfigにbrandKeywordsを追加する場合はここで使用

  // 簡易判定：ブランドタイプに基づく
  if (productConfig.brandType === "BRAND") {
    // 自社ブランド関連のキーワードかチェック
    // ここでは簡易的にasinを含むかで判定
    if (lowerQuery.includes(productConfig.asin.toLowerCase())) {
      return "BRAND_OWN";
    }
  }

  if (productConfig.brandType === "CONQUEST") {
    return "BRAND_CONQUEST";
  }

  return "GENERIC";
}

/**
 * role別の最小クリック数を取得
 */
function getMinClicksByRole(
  role: QueryRole,
  requiredClicks: number,
  config: NegativeSuggestConfig
): number {
  let roleMinClicks: number;

  switch (role) {
    case "BRAND_OWN":
      roleMinClicks = config.minClicksBrandOwn;
      break;
    case "BRAND_CONQUEST":
      roleMinClicks = config.minClicksBrandConquest;
      break;
    case "GENERIC":
    default:
      roleMinClicks = config.minClicksGeneric;
      break;
  }

  return Math.max(requiredClicks, roleMinClicks);
}

/**
 * マッチタイプを正規化
 */
function normalizeMatchType(matchType: string): NegativeMatchType {
  const upper = matchType.toUpperCase();
  if (upper === "PHRASE") return "PHRASE";
  if (upper === "EXACT") return "EXACT";
  return "AUTO";
}

/**
 * 理由コードを決定
 */
function determineReasonCodes(
  stats: SearchTermStats30dRow,
  clusterStats: IntentClusterStats30dRow | undefined,
  avgAsinCpc: number,
  config: NegativeSuggestConfig
): NegativeReasonCode[] {
  const reasons: NegativeReasonCode[] = [];

  // NG_NO_CONVERSION: CVR=0 かつクリック数がしきい値超え
  if (stats.conversions_30d === 0 && stats.clicks_30d > 0) {
    reasons.push("NG_NO_CONVERSION");
  }

  // NG_WASTED_SPEND: CPCが全体より高く、コストがかさみ過ぎ
  const cpcRatioThreshold = config.cpcRatioThreshold || 1.5;
  const minWastedCost = config.minWastedCost || 1000;

  if (
    stats.cpc_30d &&
    avgAsinCpc > 0 &&
    stats.cpc_30d > avgAsinCpc * cpcRatioThreshold &&
    stats.cost_30d >= minWastedCost
  ) {
    reasons.push("NG_WASTED_SPEND");
  }

  // NG_CLUSTER_NO_CONVERSION: クラスタ単位でCVR=0
  if (
    clusterStats &&
    clusterStats.cluster_conversions_30d === 0 &&
    clusterStats.cluster_clicks_30d > 0
  ) {
    reasons.push("NG_CLUSTER_NO_CONVERSION");
  }

  // NG_INTENT_MISMATCH: 検索意図が商品と不一致
  // TODO: product_config.expected_intents / negative_patterns との照合を実装
  // 現時点では intent_cluster_id がない場合にフラグを立てる
  if (!stats.intent_cluster_id) {
    reasons.push("NG_INTENT_MISMATCH");
  }

  return reasons;
}

/**
 * 理由の詳細説明を生成
 */
function buildReasonDetail(
  stats: SearchTermStats30dRow,
  reasonCodes: NegativeReasonCode[],
  requiredClicks: number,
  avgAsinCpc: number
): string {
  const details: string[] = [];

  if (reasonCodes.includes("NG_NO_CONVERSION")) {
    details.push(
      `CVR=0 (${stats.clicks_30d}clicks, 必要=${requiredClicks}clicks)`
    );
  }

  if (reasonCodes.includes("NG_WASTED_SPEND")) {
    details.push(
      `高CPC: ¥${stats.cpc_30d?.toFixed(0) || 0} (平均¥${avgAsinCpc.toFixed(0)}の${((stats.cpc_30d || 0) / avgAsinCpc).toFixed(1)}倍)`
    );
  }

  if (reasonCodes.includes("NG_CLUSTER_NO_CONVERSION")) {
    details.push(`クラスタ全体でCVR=0`);
  }

  if (reasonCodes.includes("NG_INTENT_MISMATCH")) {
    details.push(`検索意図不一致（クラスタ未分類）`);
  }

  return details.join("; ");
}

// =============================================================================
// メイン関数
// =============================================================================

/**
 * ネガティブキーワード候補を計算
 *
 * @param asin - 対象ASIN
 * @param productConfig - 商品設定
 * @param negativeConfig - ネガティブ候補設定
 * @param mode - 実行モード（SHADOW or APPLY）
 * @param options - オプション設定
 * @returns ネガティブキーワード候補の計算結果
 */
export async function computeNegativeKeywordCandidates(
  asin: string,
  productConfig: ProductConfig,
  negativeConfig: NegativeSuggestConfig = DEFAULT_NEGATIVE_SUGGEST_CONFIG,
  mode: ExecutionMode = "SHADOW",
  options: {
    projectId?: string;
    dataset?: string;
    executionId?: string;
  } = {}
): Promise<NegativeKeywordCandidatesResult> {
  const projectId = options.projectId || process.env.BIGQUERY_PROJECT_ID || "rpptool";
  const dataset = options.dataset || process.env.BIGQUERY_DATASET || "amazon_bid_engine";
  const executionId = options.executionId || uuidv4();

  logger.info("Computing negative keyword candidates", {
    asin,
    mode,
    lifecycleState: productConfig.lifecycleState,
  });

  // ライフサイクルステートのチェック
  if (isExcludedLifecycleState(productConfig.lifecycleState)) {
    logger.info("Skipping negative candidate generation for launch phase", {
      asin,
      lifecycleState: productConfig.lifecycleState,
    });

    return {
      asin,
      mode,
      candidates: [],
      baselineAsinCvr30d: 0,
      requiredClicks: 0,
      totalQueriesProcessed: 0,
      candidateClustersCount: 0,
      stats: {
        totalClicks30d: 0,
        totalConversions30d: 0,
        totalCost30d: 0,
      },
    };
  }

  // 3-1: ASIN全体のベースラインCVRを計算
  const minimumBaselineCvr = negativeConfig.minimumBaselineCvr || 0.01;
  const { cvr: baselineAsinCvr30d, totalClicks, totalConversions } =
    await fetchBaselineAsinCvr(projectId, dataset, asin, minimumBaselineCvr);

  // 3-2: ルールオブスリーによる必要クリック数
  const requiredClicks = calculateRequiredClicks(
    baselineAsinCvr30d,
    negativeConfig.riskTolerance
  );

  logger.debug("Calculated baseline and required clicks", {
    asin,
    baselineAsinCvr30d,
    requiredClicks,
    totalClicks,
    totalConversions,
  });

  // データ取得
  const [searchTermStats, clusterStatsMap, avgAsinCpc] = await Promise.all([
    fetchSearchTermStats(projectId, dataset, asin),
    fetchClusterStats(projectId, dataset, asin),
    fetchAverageAsinCpc(projectId, dataset, asin),
  ]);

  // 3-4: 候補クラスタの特定
  const candidateClusterIds = new Set<string>();
  for (const [clusterId, clusterStats] of clusterStatsMap) {
    if (
      clusterStats.cluster_conversions_30d === 0 &&
      clusterStats.cluster_clicks_30d >= negativeConfig.minClusterClicks &&
      clusterStats.cluster_clicks_30d >= requiredClicks
    ) {
      candidateClusterIds.add(clusterId);
    }
  }

  logger.debug("Identified candidate clusters", {
    asin,
    candidateClusterCount: candidateClusterIds.size,
    clusterIds: Array.from(candidateClusterIds),
  });

  // 3-5: キーワード単位の候補を生成
  const candidates: NegativeKeywordCandidate[] = [];
  let totalCost30d = 0;

  for (const stats of searchTermStats) {
    totalCost30d += Number(stats.cost_30d) || 0;

    // 候補クラスタに属するレコードのみを対象
    if (stats.intent_cluster_id && !candidateClusterIds.has(stats.intent_cluster_id)) {
      continue;
    }

    // CVR=0 でない場合はスキップ
    if (stats.conversions_30d > 0) {
      continue;
    }

    // 役割を判定
    const role = determineQueryRole(stats.query, productConfig);

    // 3-3: role別の最小クリック数
    const minClicksByRole = getMinClicksByRole(role, requiredClicks, negativeConfig);

    // クリック数が閾値未満の場合はスキップ
    if (stats.clicks_30d < minClicksByRole) {
      continue;
    }

    // コストが一定以上かチェック（オプション）
    const minWastedCost = negativeConfig.minWastedCost || 0;
    if (stats.cost_30d < minWastedCost) {
      continue;
    }

    // クラスタ統計を取得
    const clusterStats = stats.intent_cluster_id
      ? clusterStatsMap.get(stats.intent_cluster_id)
      : undefined;

    // 3-6: 理由コードを決定
    const reasonCodes = determineReasonCodes(stats, clusterStats, avgAsinCpc, negativeConfig);

    // 理由コードがない場合はスキップ
    if (reasonCodes.length === 0) {
      continue;
    }

    // 理由詳細を生成
    const reasonDetail = buildReasonDetail(stats, reasonCodes, requiredClicks, avgAsinCpc);

    // 候補を生成
    const candidate: NegativeKeywordCandidate = {
      asin: stats.asin,
      query: stats.query,
      matchType: normalizeMatchType(stats.match_type),
      intentClusterId: stats.intent_cluster_id,
      role,
      clicks30d: stats.clicks_30d,
      conversions30d: stats.conversions_30d,
      cost30d: Number(stats.cost_30d),
      cpc30d: Number(stats.cpc_30d) || 0,
      cvr30d: stats.cvr_30d,
      acos30d: stats.acos_30d,
      clusterClicks30d: clusterStats?.cluster_clicks_30d,
      clusterConversions30d: clusterStats?.cluster_conversions_30d,
      clusterCost30d: clusterStats ? Number(clusterStats.cluster_cost_30d) : undefined,
      clusterCvr30d: clusterStats?.cluster_cvr_30d ?? undefined,
      baselineAsinCvr30d,
      reasonCodes,
      reasonDetail,
      requiredClicks,
      minClicksByRole,
    };

    candidates.push(candidate);
  }

  logger.info("Generated negative keyword candidates", {
    asin,
    candidatesCount: candidates.length,
    totalQueriesProcessed: searchTermStats.length,
    candidateClustersCount: candidateClusterIds.size,
  });

  // SHADOWモードの場合のみBigQueryに保存
  if (mode === "SHADOW" && candidates.length > 0) {
    await saveNegativeKeywordSuggestions(
      projectId,
      dataset,
      executionId,
      mode,
      candidates,
      productConfig.lifecycleState
    );
  }

  return {
    asin,
    mode,
    candidates,
    baselineAsinCvr30d,
    requiredClicks,
    totalQueriesProcessed: searchTermStats.length,
    candidateClustersCount: candidateClusterIds.size,
    stats: {
      totalClicks30d: totalClicks,
      totalConversions30d: totalConversions,
      totalCost30d,
    },
  };
}

// =============================================================================
// BigQuery保存
// =============================================================================

/**
 * ネガティブキーワード候補をBigQueryに保存
 */
async function saveNegativeKeywordSuggestions(
  projectId: string,
  dataset: string,
  executionId: string,
  mode: ExecutionMode,
  candidates: NegativeKeywordCandidate[],
  lifecycleState: string | undefined
): Promise<void> {
  const bq = getBigQueryClient();
  const table = bq.dataset(dataset).table("negative_keyword_suggestions");

  const rows: NegativeKeywordSuggestionRow[] = candidates.map((candidate) => ({
    suggestion_id: uuidv4(),
    execution_id: executionId,
    execution_mode: mode,
    asin: candidate.asin,
    query: candidate.query,
    match_type: candidate.matchType,
    intent_cluster_id: candidate.intentClusterId,
    role: candidate.role,
    clicks_30d: candidate.clicks30d,
    conversions_30d: candidate.conversions30d,
    cost_30d: candidate.cost30d,
    cpc_30d: candidate.cpc30d,
    cvr_30d: candidate.cvr30d,
    acos_30d: candidate.acos30d,
    cluster_clicks_30d: candidate.clusterClicks30d ?? null,
    cluster_conversions_30d: candidate.clusterConversions30d ?? null,
    cluster_cost_30d: candidate.clusterCost30d ?? null,
    cluster_cvr_30d: candidate.clusterCvr30d ?? null,
    baseline_asin_cvr_30d: candidate.baselineAsinCvr30d,
    required_clicks: candidate.requiredClicks || 0,
    min_clicks_by_role: candidate.minClicksByRole || 0,
    reason_codes: candidate.reasonCodes,
    reason_detail: candidate.reasonDetail || null,
    // 承認フロー関連フィールド（新規候補は PENDING）
    status: "PENDING",
    approved_at: null,
    approved_by: null,
    rejected_at: null,
    rejected_by: null,
    rejection_reason: null,
    is_applied: false,
    applied_at: null,
    apply_error: null,
    lifecycle_state: lifecycleState || null,
    suggested_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  }));

  try {
    await table.insert(rows);
    logger.info("Saved negative keyword suggestions to BigQuery", {
      executionId,
      count: rows.length,
    });
  } catch (error) {
    logger.error("Failed to save negative keyword suggestions", {
      executionId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// =============================================================================
// ガードレール対応のネガティブ候補チェック
// =============================================================================

/**
 * ガードレール対応版のネガティブ候補検証コンテキスト
 */
export interface NegativeGuardrailContext {
  /** キーワードロール */
  keywordRole: KeywordRole;
  /** ライフサイクルステージ */
  lifecycleStage: LifecycleState;
  /** セールフェーズ */
  salePhase: SalePhase;
  /** プレセールタイプ */
  presaleType: PresaleType;
  /** lossBudget状態 */
  lossBudgetState: LossBudgetState;
  /** 加重クリック数（例: 30日間） */
  clicksW: number;
  /** 現在のACOS（null=データなし） */
  acosW: number | null;
  /** 目標ACOS */
  targetAcos: number;
}

/**
 * ガードレール対応版のネガティブ候補検証結果
 */
export interface NegativeGuardrailCheckResult {
  /** ネガティブ候補として許可されるか */
  isAllowed: boolean;
  /** 適用されたガードレール */
  guardrails: RoleLifecycleGuardrails;
  /** overspendRatio */
  overspendRatio: number;
  /** STOPアクションの閾値を満たしているか */
  meetsStopThreshold: boolean;
  /** 許可されない場合の理由 */
  rejectionReason: string | null;
}

/**
 * ガードレールに基づいてネガティブキーワード候補の可否を判定
 *
 * STOP判定と連動しつつ、「CORE×LAUNCH」など守るべきキーワードは
 * 自動NEGにしないようにする。
 *
 * 条件:
 * - guardrails.allowNegative が true
 * - guardrails.allowStop が true
 * - STOP用の閾値（clicks_w >= minClicksStop, overspendRatio >= overspendThresholdStop）を満たす
 *
 * @param ctx - ネガティブガードレールコンテキスト
 * @returns ネガティブ候補の検証結果
 *
 * @example
 * ```typescript
 * const result = checkNegativeCandidateWithGuardrails({
 *   keywordRole: "CORE",
 *   lifecycleStage: "LAUNCH_HARD",
 *   salePhase: "NORMAL",
 *   presaleType: "NONE",
 *   lossBudgetState: "SAFE",
 *   clicksW: 100,
 *   acosW: 0.50,
 *   targetAcos: 0.25,
 * });
 *
 * if (!result.isAllowed) {
 *   // CORE×LAUNCH_HARD では allowNegative = false のため候補から除外
 *   console.log(result.rejectionReason);
 * }
 * ```
 */
export function checkNegativeCandidateWithGuardrails(
  ctx: NegativeGuardrailContext
): NegativeGuardrailCheckResult {
  const {
    keywordRole,
    lifecycleStage,
    salePhase,
    presaleType,
    lossBudgetState,
    clicksW,
    acosW,
    targetAcos,
  } = ctx;

  // 1. ガードレールを取得
  const guardrailContext: GuardrailContext = {
    role: keywordRole,
    lifecycleStage,
    salePhase,
    presaleType,
    lossBudgetState,
  };
  const guardrails = getRoleLifecycleGuardrails(guardrailContext);

  // 2. overspendRatioを計算
  const overspendRatio = computeOverspendRatio(acosW, targetAcos);

  // 3. STOP閾値をチェック
  const meetsStopThreshold = meetsActionThreshold("STOP", clicksW, overspendRatio, guardrails);

  // 4. ネガティブ候補として許可されるか判定
  let isAllowed = true;
  let rejectionReason: string | null = null;

  // allowNegativeがfalseの場合
  if (!guardrails.allowNegative) {
    isAllowed = false;
    rejectionReason = `ネガティブ禁止 (${guardrails.reason})`;
  }
  // allowStopがfalseの場合（NEGとSTOPは連動）
  else if (!guardrails.allowStop) {
    isAllowed = false;
    rejectionReason = `STOP禁止によりネガティブも抑制 (${guardrails.reason})`;
  }
  // STOP閾値を満たさない場合
  else if (!meetsStopThreshold) {
    isAllowed = false;
    rejectionReason = `STOP閾値未達 (clicks=${clicksW} < ${guardrails.minClicksStop}, overspend=${overspendRatio.toFixed(2)} < ${guardrails.overspendThresholdStop})`;
  }

  return {
    isAllowed,
    guardrails,
    overspendRatio,
    meetsStopThreshold,
    rejectionReason,
  };
}

/**
 * QueryRoleをKeywordRoleに変換
 *
 * @param queryRole - クエリの役割
 * @returns キーワードロール
 */
export function convertQueryRoleToKeywordRole(queryRole: QueryRole): KeywordRole {
  switch (queryRole) {
    case "BRAND_OWN":
      return "CORE"; // 自社ブランドキーワードはCORE扱い
    case "BRAND_CONQUEST":
      return "EXPERIMENT"; // 競合ブランド攻略はEXPERIMENT扱い
    case "GENERIC":
      return "SUPPORT"; // 汎用キーワードはSUPPORT扱い
    case "OTHER":
    default:
      return "EXPERIMENT"; // その他はEXPERIMENT扱い
  }
}

/**
 * ガードレール対応版のネガティブキーワード候補フィルタ
 *
 * 既存の候補リストに対して、ガードレールに基づいてフィルタリングを行う。
 *
 * @param candidates - 候補リスト
 * @param lifecycleStage - ライフサイクルステージ
 * @param salePhase - セールフェーズ
 * @param presaleType - プレセールタイプ
 * @param lossBudgetState - lossBudget状態
 * @param targetAcos - 目標ACOS
 * @returns フィルタリング後の候補リストと除外された候補の情報
 */
export function filterNegativeCandidatesWithGuardrails(
  candidates: NegativeKeywordCandidate[],
  lifecycleStage: LifecycleState,
  salePhase: SalePhase = "NORMAL",
  presaleType: PresaleType = "NONE",
  lossBudgetState: LossBudgetState = "SAFE",
  targetAcos: number = 0.25
): {
  allowed: NegativeKeywordCandidate[];
  rejected: Array<{
    candidate: NegativeKeywordCandidate;
    rejectionReason: string;
    guardrails: RoleLifecycleGuardrails;
  }>;
  stats: {
    totalCandidates: number;
    allowedCount: number;
    rejectedCount: number;
    rejectedByRole: Record<KeywordRole, number>;
  };
} {
  const allowed: NegativeKeywordCandidate[] = [];
  const rejected: Array<{
    candidate: NegativeKeywordCandidate;
    rejectionReason: string;
    guardrails: RoleLifecycleGuardrails;
  }> = [];
  const rejectedByRole: Record<KeywordRole, number> = {
    CORE: 0,
    SUPPORT: 0,
    EXPERIMENT: 0,
  };

  for (const candidate of candidates) {
    // QueryRoleをKeywordRoleに変換
    const keywordRole = convertQueryRoleToKeywordRole(candidate.role);

    // ガードレールチェック
    const checkResult = checkNegativeCandidateWithGuardrails({
      keywordRole,
      lifecycleStage,
      salePhase,
      presaleType,
      lossBudgetState,
      clicksW: candidate.clicks30d,
      acosW: candidate.acos30d,
      targetAcos,
    });

    if (checkResult.isAllowed) {
      allowed.push(candidate);
    } else {
      rejected.push({
        candidate,
        rejectionReason: checkResult.rejectionReason || "不明な理由",
        guardrails: checkResult.guardrails,
      });
      rejectedByRole[keywordRole]++;
    }
  }

  return {
    allowed,
    rejected,
    stats: {
      totalCandidates: candidates.length,
      allowedCount: allowed.length,
      rejectedCount: rejected.length,
      rejectedByRole,
    },
  };
}

// =============================================================================
// エクスポート
// =============================================================================

export {
  calculateRequiredClicks,
  determineQueryRole,
  getMinClicksByRole,
  determineReasonCodes,
};
