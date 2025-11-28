/**
 * A/Bテストグループ割り当てロジック
 *
 * MurmurHash3を使用した一貫性のあるグループ割り当て
 * 同じキーは常に同じグループに割り当てられる
 */

import {
  ABTestConfig,
  ABTestAssignment,
  AssignmentLevel,
  TestGroup,
} from "./types";

// =============================================================================
// MurmurHash3 実装
// =============================================================================

/**
 * MurmurHash3 32bit実装
 *
 * 高速で分布の良いハッシュ関数
 * 参考: https://en.wikipedia.org/wiki/MurmurHash
 *
 * @param key - ハッシュ対象の文字列
 * @param seed - シード値（デフォルト: 0）
 * @returns 32bit符号なし整数のハッシュ値
 */
export function murmurhash3_32(key: string, seed: number = 0): number {
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  const r1 = 15;
  const r2 = 13;
  const m = 5;
  const n = 0xe6546b64;

  let hash = seed >>> 0;
  const len = key.length;

  // 4バイトずつ処理
  const nblocks = Math.floor(len / 4);
  for (let i = 0; i < nblocks; i++) {
    let k =
      (key.charCodeAt(i * 4) & 0xff) |
      ((key.charCodeAt(i * 4 + 1) & 0xff) << 8) |
      ((key.charCodeAt(i * 4 + 2) & 0xff) << 16) |
      ((key.charCodeAt(i * 4 + 3) & 0xff) << 24);

    k = Math.imul(k, c1);
    k = (k << r1) | (k >>> (32 - r1));
    k = Math.imul(k, c2);

    hash ^= k;
    hash = (hash << r2) | (hash >>> (32 - r2));
    hash = Math.imul(hash, m) + n;
  }

  // 残りのバイトを処理
  const tail = len - nblocks * 4;
  let k1 = 0;
  switch (tail) {
    case 3:
      k1 ^= (key.charCodeAt(nblocks * 4 + 2) & 0xff) << 16;
    // fallthrough
    case 2:
      k1 ^= (key.charCodeAt(nblocks * 4 + 1) & 0xff) << 8;
    // fallthrough
    case 1:
      k1 ^= key.charCodeAt(nblocks * 4) & 0xff;
      k1 = Math.imul(k1, c1);
      k1 = (k1 << r1) | (k1 >>> (32 - r1));
      k1 = Math.imul(k1, c2);
      hash ^= k1;
  }

  // ファイナライゼーション
  hash ^= len;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;

  return hash >>> 0; // 符号なし32bit整数として返す
}

// =============================================================================
// グループ割り当てロジック
// =============================================================================

/**
 * ハッシュ値を0-1の範囲に正規化
 *
 * @param hash - 32bit符号なし整数のハッシュ値
 * @returns 0-1の範囲の浮動小数点数
 */
export function normalizeHash(hash: number): number {
  return hash / 0xffffffff;
}

/**
 * 割り当てキーを生成
 *
 * テストIDとエンティティキーを組み合わせて一意のキーを生成
 *
 * @param testId - テストID
 * @param entityKey - エンティティキー（campaignId / asin / keywordId）
 * @returns 割り当てキー
 */
export function createAssignmentKey(testId: string, entityKey: string): string {
  return `${testId}|${entityKey}`;
}

/**
 * グループを決定
 *
 * @param normalizedHash - 正規化されたハッシュ値（0-1）
 * @param testGroupRatio - テストグループへの割り当て比率（0-1）
 * @returns 割り当てられたグループ
 */
export function determineGroup(
  normalizedHash: number,
  testGroupRatio: number
): TestGroup {
  // ハッシュ値がテストグループ比率未満ならTEST、それ以外はCONTROL
  return normalizedHash < testGroupRatio ? "TEST" : "CONTROL";
}

/**
 * 単一エンティティをグループに割り当て
 *
 * @param testId - テストID
 * @param entityKey - エンティティキー（campaignId / asin / keywordId）
 * @param assignmentLevel - 割り当て粒度
 * @param testGroupRatio - テストグループへの割り当て比率（0-1）
 * @param seed - ハッシュシード（オプション、デフォルト: 0）
 * @returns グループ割り当て結果
 */
export function assignToGroup(
  testId: string,
  entityKey: string,
  assignmentLevel: AssignmentLevel,
  testGroupRatio: number,
  seed: number = 0
): ABTestAssignment {
  // 割り当てキーを生成
  const assignmentKey = createAssignmentKey(testId, entityKey);

  // ハッシュを計算
  const hash = murmurhash3_32(assignmentKey, seed);

  // 正規化してグループを決定
  const normalizedHash = normalizeHash(hash);
  const group = determineGroup(normalizedHash, testGroupRatio);

  return {
    testId,
    assignmentKey: entityKey,
    assignmentLevel,
    group,
    assignedAt: new Date(),
    hashValue: hash,
  };
}

/**
 * 複数エンティティをグループに割り当て
 *
 * @param testConfig - テスト設定
 * @param entityKeys - エンティティキーの配列
 * @returns グループ割り当て結果の配列
 */
export function assignMultipleToGroups(
  testConfig: ABTestConfig,
  entityKeys: string[]
): ABTestAssignment[] {
  return entityKeys.map((entityKey) =>
    assignToGroup(
      testConfig.testId,
      entityKey,
      testConfig.assignmentLevel,
      testConfig.testGroupRatio
    )
  );
}

// =============================================================================
// 割り当て検証
// =============================================================================

/**
 * 割り当て結果の統計を計算
 *
 * @param assignments - 割り当て結果の配列
 * @returns 統計情報
 */
export function calculateAssignmentStats(
  assignments: ABTestAssignment[]
): {
  total: number;
  controlCount: number;
  testCount: number;
  controlRatio: number;
  testRatio: number;
} {
  const total = assignments.length;
  const controlCount = assignments.filter((a) => a.group === "CONTROL").length;
  const testCount = assignments.filter((a) => a.group === "TEST").length;

  return {
    total,
    controlCount,
    testCount,
    controlRatio: total > 0 ? controlCount / total : 0,
    testRatio: total > 0 ? testCount / total : 0,
  };
}

/**
 * 割り当て比率が期待値と一致しているか検証（カイ二乗検定）
 *
 * @param assignments - 割り当て結果の配列
 * @param expectedTestRatio - 期待されるテストグループ比率
 * @param alpha - 有意水準（デフォルト: 0.05）
 * @returns 検証結果
 */
export function validateAssignmentDistribution(
  assignments: ABTestAssignment[],
  expectedTestRatio: number,
  alpha: number = 0.05
): {
  isValid: boolean;
  observedTestRatio: number;
  expectedTestRatio: number;
  chiSquare: number;
  criticalValue: number;
  message: string;
} {
  const stats = calculateAssignmentStats(assignments);
  const n = stats.total;

  if (n === 0) {
    return {
      isValid: false,
      observedTestRatio: 0,
      expectedTestRatio,
      chiSquare: 0,
      criticalValue: 0,
      message: "割り当て結果がありません",
    };
  }

  const expectedControlCount = n * (1 - expectedTestRatio);
  const expectedTestCount = n * expectedTestRatio;

  // カイ二乗統計量を計算
  const chiSquare =
    Math.pow(stats.controlCount - expectedControlCount, 2) / expectedControlCount +
    Math.pow(stats.testCount - expectedTestCount, 2) / expectedTestCount;

  // 自由度1のカイ二乗分布の臨界値（よく使われる値）
  const criticalValues: Record<number, number> = {
    0.1: 2.706,
    0.05: 3.841,
    0.01: 6.635,
    0.001: 10.828,
  };
  const criticalValue = criticalValues[alpha] || 3.841;

  const isValid = chiSquare <= criticalValue;

  return {
    isValid,
    observedTestRatio: stats.testRatio,
    expectedTestRatio,
    chiSquare,
    criticalValue,
    message: isValid
      ? `割り当て比率は期待値と一致しています（χ² = ${chiSquare.toFixed(3)}）`
      : `割り当て比率が期待値と有意に異なります（χ² = ${chiSquare.toFixed(3)} > ${criticalValue}）`,
  };
}

// =============================================================================
// キャッシュ付きAssigner
// =============================================================================

/**
 * キャッシュ付きグループ割り当てクラス
 *
 * 同じエンティティに対する割り当てをキャッシュして、
 * 一貫性を保ちながらパフォーマンスを向上
 */
export class CachedGroupAssigner {
  private cache: Map<string, ABTestAssignment> = new Map();
  private testConfig: ABTestConfig;

  constructor(testConfig: ABTestConfig) {
    this.testConfig = testConfig;
  }

  /**
   * エンティティをグループに割り当て（キャッシュ付き）
   *
   * @param entityKey - エンティティキー
   * @returns グループ割り当て結果
   */
  assign(entityKey: string): ABTestAssignment {
    const cacheKey = createAssignmentKey(this.testConfig.testId, entityKey);

    // キャッシュにあればそれを返す
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // 新規割り当て
    const assignment = assignToGroup(
      this.testConfig.testId,
      entityKey,
      this.testConfig.assignmentLevel,
      this.testConfig.testGroupRatio
    );

    // キャッシュに保存
    this.cache.set(cacheKey, assignment);

    return assignment;
  }

  /**
   * 複数エンティティをグループに割り当て（キャッシュ付き）
   *
   * @param entityKeys - エンティティキーの配列
   * @returns グループ割り当て結果の配列
   */
  assignMultiple(entityKeys: string[]): ABTestAssignment[] {
    return entityKeys.map((key) => this.assign(key));
  }

  /**
   * キャッシュをクリア
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * キャッシュサイズを取得
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * キャッシュから割り当てを取得
   *
   * @param entityKey - エンティティキー
   * @returns キャッシュされた割り当て（なければundefined）
   */
  getCachedAssignment(entityKey: string): ABTestAssignment | undefined {
    const cacheKey = createAssignmentKey(this.testConfig.testId, entityKey);
    return this.cache.get(cacheKey);
  }

  /**
   * 既存の割り当てをキャッシュに追加
   *
   * @param assignments - 既存の割り当て（BigQueryから取得したもの等）
   */
  loadAssignments(assignments: ABTestAssignment[]): void {
    for (const assignment of assignments) {
      const cacheKey = createAssignmentKey(
        this.testConfig.testId,
        assignment.assignmentKey
      );
      this.cache.set(cacheKey, assignment);
    }
  }
}

// =============================================================================
// ファクトリ関数
// =============================================================================

/**
 * テスト設定からキャッシュ付きAssignerを作成
 *
 * @param testConfig - テスト設定
 * @param existingAssignments - 既存の割り当て（オプション）
 * @returns CachedGroupAssigner インスタンス
 */
export function createAssigner(
  testConfig: ABTestConfig,
  existingAssignments?: ABTestAssignment[]
): CachedGroupAssigner {
  const assigner = new CachedGroupAssigner(testConfig);

  if (existingAssignments && existingAssignments.length > 0) {
    assigner.loadAssignments(existingAssignments);
  }

  return assigner;
}
