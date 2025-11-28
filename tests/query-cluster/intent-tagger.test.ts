/**
 * 検索意図タグ検出テスト
 */

import {
  detectQueryIntentTag,
  detectQueryIntentTagWithDetails,
  generateQueryClusterId,
  parseQueryClusterId,
} from "../../src/negative-keywords/query-cluster/intent-tagger";

describe("intent-tagger", () => {
  describe("detectQueryIntentTag", () => {
    describe("child（子供向け）", () => {
      it("キッズを検出する", () => {
        expect(detectQueryIntentTag("キッズ シャンプー")).toBe("child");
      });

      it("子供を検出する", () => {
        expect(detectQueryIntentTag("子供用 シャンプー")).toBe("child");
      });

      it("ベビーを検出する", () => {
        expect(detectQueryIntentTag("ベビー シャンプー")).toBe("child");
      });

      it("年齢を検出する", () => {
        expect(detectQueryIntentTag("3歳 シャンプー")).toBe("child");
      });

      it("小学生を検出する", () => {
        expect(detectQueryIntentTag("小学生 シャンプー")).toBe("child");
      });

      it("ひらがなでも検出する", () => {
        expect(detectQueryIntentTag("きっず しゃんぷー")).toBe("child");
      });
    });

    describe("adult（大人向け）", () => {
      it("メンズを検出する", () => {
        expect(detectQueryIntentTag("メンズ シャンプー")).toBe("adult");
      });

      it("レディースを検出する", () => {
        expect(detectQueryIntentTag("レディース シャンプー")).toBe("adult");
      });

      it("大人を検出する", () => {
        expect(detectQueryIntentTag("大人用 シャンプー")).toBe("adult");
      });

      it("年齢層を検出する", () => {
        expect(detectQueryIntentTag("40代 シャンプー")).toBe("adult");
      });

      it("シニアを検出する", () => {
        expect(detectQueryIntentTag("シニア シャンプー")).toBe("adult");
      });
    });

    describe("concern（悩み系）", () => {
      it("かゆみを検出する", () => {
        expect(detectQueryIntentTag("かゆみ シャンプー")).toBe("concern");
      });

      it("フケを検出する", () => {
        expect(detectQueryIntentTag("フケ 対策 シャンプー")).toBe("concern");
      });

      it("薄毛を検出する", () => {
        expect(detectQueryIntentTag("薄毛 シャンプー")).toBe("concern");
      });

      it("敏感肌を検出する", () => {
        expect(detectQueryIntentTag("敏感肌 シャンプー")).toBe("concern");
      });

      it("対策を検出する", () => {
        expect(detectQueryIntentTag("頭皮 対策")).toBe("concern");
      });
    });

    describe("info（情報探索）", () => {
      it("おすすめを検出する", () => {
        expect(detectQueryIntentTag("シャンプー おすすめ")).toBe("info");
      });

      it("ランキングを検出する", () => {
        expect(detectQueryIntentTag("シャンプー ランキング")).toBe("info");
      });

      it("口コミを検出する", () => {
        expect(detectQueryIntentTag("シャンプー 口コミ")).toBe("info");
      });

      it("比較を検出する", () => {
        expect(detectQueryIntentTag("シャンプー 比較")).toBe("info");
      });

      it("選び方を検出する", () => {
        expect(detectQueryIntentTag("シャンプー 選び方")).toBe("info");
      });
    });

    describe("generic（汎用）", () => {
      it("特徴的なキーワードがない場合はgeneric", () => {
        expect(detectQueryIntentTag("シャンプー")).toBe("generic");
      });

      it("ブランド名のみの場合はgeneric", () => {
        expect(detectQueryIntentTag("パンテーン シャンプー")).toBe("generic");
      });
    });

    describe("優先順位", () => {
      it("childはadultより優先される", () => {
        // 実際にはこのような検索はないが、優先順位テスト
        expect(detectQueryIntentTag("キッズ メンズ シャンプー")).toBe("child");
      });

      it("adultはconcernより優先される", () => {
        expect(detectQueryIntentTag("メンズ 頭皮ケア シャンプー")).toBe("adult");
      });

      it("concernはinfoより優先される", () => {
        expect(detectQueryIntentTag("フケ対策 おすすめ シャンプー")).toBe("concern");
      });
    });
  });

  describe("detectQueryIntentTagWithDetails", () => {
    it("マッチしたキーワードを返す", () => {
      const result = detectQueryIntentTagWithDetails("キッズ ベビー シャンプー");
      expect(result.intentTag).toBe("child");
      expect(result.matchedKeywords.child.length).toBeGreaterThan(0);
      expect(result.confidence).toBe("high"); // 2つ以上マッチ
    });

    it("正規化されたクエリを返す", () => {
      const result = detectQueryIntentTagWithDetails("ＡＢＣきっず");
      expect(result.normalizedQuery).toBe("abcキッズ");
    });

    it("信頼度を正しく判定する", () => {
      // 高信頼度（2つ以上マッチ）
      const high = detectQueryIntentTagWithDetails("キッズ 子供用 シャンプー");
      expect(high.confidence).toBe("high");

      // 中信頼度（1つマッチ）
      const medium = detectQueryIntentTagWithDetails("キッズ シャンプー");
      expect(medium.confidence).toBe("medium");

      // 低信頼度（マッチなし）
      const low = detectQueryIntentTagWithDetails("シャンプー");
      expect(low.confidence).toBe("low");
    });
  });

  describe("generateQueryClusterId", () => {
    it("正しい形式のクラスターIDを生成する", () => {
      expect(generateQueryClusterId("キッズ シャンプー")).toBe("キッズ シャンプー::child");
      expect(generateQueryClusterId("シャンプー")).toBe("シャンプー::generic");
      expect(generateQueryClusterId("メンズ シャンプー")).toBe("メンズ シャンプー::adult");
    });

    it("正規化されたクエリを使用する", () => {
      expect(generateQueryClusterId("きっず　しゃんぷー")).toBe("キッズ シャンプー::child");
    });
  });

  describe("parseQueryClusterId", () => {
    it("クラスターIDをパースできる", () => {
      const result = parseQueryClusterId("キッズ シャンプー::child");
      expect(result).not.toBeNull();
      expect(result!.canonicalQuery).toBe("キッズ シャンプー");
      expect(result!.intentTag).toBe("child");
    });

    it("すべての意図タグをパースできる", () => {
      expect(parseQueryClusterId("test::child")?.intentTag).toBe("child");
      expect(parseQueryClusterId("test::adult")?.intentTag).toBe("adult");
      expect(parseQueryClusterId("test::concern")?.intentTag).toBe("concern");
      expect(parseQueryClusterId("test::info")?.intentTag).toBe("info");
      expect(parseQueryClusterId("test::generic")?.intentTag).toBe("generic");
    });

    it("無効な形式の場合はnullを返す", () => {
      expect(parseQueryClusterId("invalid")).toBeNull();
      expect(parseQueryClusterId("no::separator::here")).toBeNull();
      expect(parseQueryClusterId("test::invalid_tag")).toBeNull();
    });
  });
});
