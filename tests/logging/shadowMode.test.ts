/**
 * シャドーモードのテスト
 */

import {
  getExecutionMode,
  isShadowMode,
  isApplyMode,
  executeWithMode,
  applyBidWithMode,
} from "../../src/logging/shadowMode";

// =============================================================================
// getExecutionMode テスト
// =============================================================================

describe("getExecutionMode", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("環境変数が設定されていない場合", () => {
    it("デフォルトでSHADOWを返す", () => {
      delete process.env.BID_ENGINE_EXECUTION_MODE;
      expect(getExecutionMode()).toBe("SHADOW");
    });
  });

  describe("環境変数がAPPLYの場合", () => {
    it("APPLYを返す", () => {
      process.env.BID_ENGINE_EXECUTION_MODE = "APPLY";
      expect(getExecutionMode()).toBe("APPLY");
    });

    it("小文字でもAPPLYを返す", () => {
      process.env.BID_ENGINE_EXECUTION_MODE = "apply";
      expect(getExecutionMode()).toBe("APPLY");
    });

    it("スペースがあってもAPPLYを返す", () => {
      process.env.BID_ENGINE_EXECUTION_MODE = "  APPLY  ";
      expect(getExecutionMode()).toBe("APPLY");
    });
  });

  describe("環境変数がSHADOWの場合", () => {
    it("SHADOWを返す", () => {
      process.env.BID_ENGINE_EXECUTION_MODE = "SHADOW";
      expect(getExecutionMode()).toBe("SHADOW");
    });

    it("小文字でもSHADOWを返す", () => {
      process.env.BID_ENGINE_EXECUTION_MODE = "shadow";
      expect(getExecutionMode()).toBe("SHADOW");
    });
  });

  describe("不明な値の場合", () => {
    it("SHADOWにフォールバック", () => {
      process.env.BID_ENGINE_EXECUTION_MODE = "UNKNOWN_VALUE";
      expect(getExecutionMode()).toBe("SHADOW");
    });

    it("空文字でもSHADOWを返す", () => {
      process.env.BID_ENGINE_EXECUTION_MODE = "";
      expect(getExecutionMode()).toBe("SHADOW");
    });
  });
});

// =============================================================================
// isShadowMode / isApplyMode テスト
// =============================================================================

describe("isShadowMode", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("SHADOWモードでtrueを返す", () => {
    process.env.BID_ENGINE_EXECUTION_MODE = "SHADOW";
    expect(isShadowMode()).toBe(true);
    expect(isApplyMode()).toBe(false);
  });

  it("APPLYモードでfalseを返す", () => {
    process.env.BID_ENGINE_EXECUTION_MODE = "APPLY";
    expect(isShadowMode()).toBe(false);
    expect(isApplyMode()).toBe(true);
  });

  it("未設定時はtrueを返す（デフォルトSHADOW）", () => {
    delete process.env.BID_ENGINE_EXECUTION_MODE;
    expect(isShadowMode()).toBe(true);
    expect(isApplyMode()).toBe(false);
  });
});

// =============================================================================
// executeWithMode テスト
// =============================================================================

describe("executeWithMode", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("APPLYモード", () => {
    beforeEach(() => {
      process.env.BID_ENGINE_EXECUTION_MODE = "APPLY";
    });

    it("applyFnを実行してwasApplied=trueを返す", async () => {
      const applyFn = jest.fn().mockResolvedValue("applied result");
      const shadowFn = jest.fn().mockResolvedValue("shadow result");

      const result = await executeWithMode(applyFn, shadowFn);

      expect(applyFn).toHaveBeenCalledTimes(1);
      expect(shadowFn).not.toHaveBeenCalled();
      expect(result.result).toBe("applied result");
      expect(result.wasApplied).toBe(true);
    });
  });

  describe("SHADOWモード", () => {
    beforeEach(() => {
      process.env.BID_ENGINE_EXECUTION_MODE = "SHADOW";
    });

    it("shadowFnを実行してwasApplied=falseを返す", async () => {
      const applyFn = jest.fn().mockResolvedValue("applied result");
      const shadowFn = jest.fn().mockResolvedValue("shadow result");

      const result = await executeWithMode(applyFn, shadowFn);

      expect(applyFn).not.toHaveBeenCalled();
      expect(shadowFn).toHaveBeenCalledTimes(1);
      expect(result.result).toBe("shadow result");
      expect(result.wasApplied).toBe(false);
    });

    it("shadowFnがなければnullを返す", async () => {
      const applyFn = jest.fn().mockResolvedValue("applied result");

      const result = await executeWithMode(applyFn);

      expect(applyFn).not.toHaveBeenCalled();
      expect(result.result).toBeNull();
      expect(result.wasApplied).toBe(false);
    });
  });
});

// =============================================================================
// applyBidWithMode テスト
// =============================================================================

describe("applyBidWithMode", () => {
  const originalEnv = process.env;

  const keywordInfo = {
    keywordId: "kw123",
    keywordText: "test keyword",
    oldBid: 100,
    newBid: 120,
  };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("APPLYモード", () => {
    beforeEach(() => {
      process.env.BID_ENGINE_EXECUTION_MODE = "APPLY";
    });

    it("成功時はwasApplied=trueを返す", async () => {
      const applyFn = jest.fn().mockResolvedValue(undefined);

      const result = await applyBidWithMode(applyFn, keywordInfo);

      expect(applyFn).toHaveBeenCalledTimes(1);
      expect(result.wasApplied).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("エラー時はwasApplied=falseとerrorを返す", async () => {
      const error = new Error("API error");
      const applyFn = jest.fn().mockRejectedValue(error);

      const result = await applyBidWithMode(applyFn, keywordInfo);

      expect(applyFn).toHaveBeenCalledTimes(1);
      expect(result.wasApplied).toBe(false);
      expect(result.error).toBe(error);
    });
  });

  describe("SHADOWモード", () => {
    beforeEach(() => {
      process.env.BID_ENGINE_EXECUTION_MODE = "SHADOW";
    });

    it("applyFnを呼ばずwasApplied=falseを返す", async () => {
      const applyFn = jest.fn().mockResolvedValue(undefined);

      const result = await applyBidWithMode(applyFn, keywordInfo);

      expect(applyFn).not.toHaveBeenCalled();
      expect(result.wasApplied).toBe(false);
      expect(result.error).toBeUndefined();
    });
  });
});
