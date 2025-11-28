/**
 * リトライ・サーキットブレーカーのテスト
 */

import {
  withRetry,
  withTimeout,
  withRetryAndTimeout,
  getCircuitBreakerStatus,
  resetCircuitBreaker,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
} from "../src/utils/retry";

describe("retry", () => {
  beforeEach(() => {
    // テスト前にサーキットブレーカーをリセット
    resetCircuitBreaker("test-service");
    resetCircuitBreaker("timeout-service");
  });

  describe("withRetry", () => {
    it("should return result on first success", async () => {
      let attempts = 0;
      const result = await withRetry(
        async () => {
          attempts++;
          return "success";
        },
        { name: "test-service" }
      );

      expect(result).toBe("success");
      expect(attempts).toBe(1);
    });

    it("should retry on retryable error and eventually succeed", async () => {
      let attempts = 0;
      const result = await withRetry(
        async () => {
          attempts++;
          if (attempts < 3) {
            const error = new Error("503 Service Unavailable");
            (error as any).code = "503";
            throw error;
          }
          return "success after retry";
        },
        {
          name: "test-service",
          retryConfig: {
            maxRetries: 3,
            baseDelayMs: 10, // テスト用に短く
            maxDelayMs: 50,
          },
        }
      );

      expect(result).toBe("success after retry");
      expect(attempts).toBe(3);
    });

    it("should throw after max retries exceeded", async () => {
      let attempts = 0;

      await expect(
        withRetry(
          async () => {
            attempts++;
            const error = new Error("500 Internal Server Error");
            (error as any).code = "500";
            throw error;
          },
          {
            name: "test-service",
            retryConfig: {
              maxRetries: 2,
              baseDelayMs: 10,
            },
          }
        )
      ).rejects.toThrow("500 Internal Server Error");

      expect(attempts).toBe(3); // 初回 + 2回リトライ
    });

    it("should not retry non-retryable errors", async () => {
      let attempts = 0;

      await expect(
        withRetry(
          async () => {
            attempts++;
            const error = new Error("400 Bad Request");
            (error as any).code = "400";
            throw error;
          },
          {
            name: "test-service",
            retryConfig: {
              maxRetries: 3,
              baseDelayMs: 10,
            },
          }
        )
      ).rejects.toThrow("400 Bad Request");

      expect(attempts).toBe(1); // リトライしない
    });
  });

  describe("withTimeout", () => {
    it("should return result within timeout", async () => {
      const result = await withTimeout(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return "completed";
        },
        1000,
        "timeout-test"
      );

      expect(result).toBe("completed");
    });

    it("should throw on timeout", async () => {
      await expect(
        withTimeout(
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return "never";
          },
          10, // 短いタイムアウト
          "timeout-test"
        )
      ).rejects.toThrow("Timeout after 10ms");
    });
  });

  describe("withRetryAndTimeout", () => {
    it("should combine retry and timeout functionality", async () => {
      let attempts = 0;

      const result = await withRetryAndTimeout(
        async () => {
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 5));
          return "combined success";
        },
        {
          name: "combined-test",
          timeoutMs: 1000,
          retryConfig: {
            maxRetries: 2,
            baseDelayMs: 10,
          },
        }
      );

      expect(result).toBe("combined success");
      expect(attempts).toBe(1);
    });
  });

  describe("circuit breaker", () => {
    it("should start in CLOSED state", () => {
      const status = getCircuitBreakerStatus("new-service");
      expect(status.state).toBe("CLOSED");
      expect(status.failures).toBe(0);
    });

    it("should open after failure threshold reached", async () => {
      const serviceName = "failing-service";
      resetCircuitBreaker(serviceName);

      // 失敗を繰り返してサーキットブレーカーを開く
      for (let i = 0; i < DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold; i++) {
        try {
          await withRetry(
            async () => {
              const error = new Error("500 Internal Server Error");
              (error as any).code = "500";
              throw error;
            },
            {
              name: serviceName,
              retryConfig: {
                maxRetries: 0, // リトライなし
                baseDelayMs: 10,
              },
            }
          );
        } catch {
          // 例外は無視
        }
      }

      const status = getCircuitBreakerStatus(serviceName);
      expect(status.state).toBe("OPEN");
    });

    it("should reject requests when circuit is open", async () => {
      const serviceName = "open-circuit-service";
      resetCircuitBreaker(serviceName);

      // サーキットを開く
      for (let i = 0; i < DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold; i++) {
        try {
          await withRetry(
            async () => {
              const error = new Error("500");
              (error as any).code = "500";
              throw error;
            },
            { name: serviceName, retryConfig: { maxRetries: 0, baseDelayMs: 10 } }
          );
        } catch {
          // 無視
        }
      }

      // オープン状態でリクエストすると拒否される
      await expect(
        withRetry(
          async () => "should not execute",
          { name: serviceName }
        )
      ).rejects.toThrow("Circuit breaker is open");
    });

    it("should reset circuit breaker manually", () => {
      const serviceName = "reset-test-service";

      // 手動リセット
      resetCircuitBreaker(serviceName);
      const status = getCircuitBreakerStatus(serviceName);

      expect(status.state).toBe("CLOSED");
      expect(status.failures).toBe(0);
    });
  });
});
