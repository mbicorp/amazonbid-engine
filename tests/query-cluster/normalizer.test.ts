/**
 * クエリ正規化テスト
 */

import {
  normalizeQuery,
  toCanonicalQuery,
  DEFAULT_NORMALIZER_CONFIG,
  _internal,
} from "../../src/negative-keywords/query-cluster/normalizer";

describe("normalizer", () => {
  describe("toCanonicalQuery", () => {
    it("全角英数字を半角に変換する", () => {
      expect(toCanonicalQuery("ＡＢＣ１２３")).toBe("abc123");
    });

    it("全角スペースを半角に変換する", () => {
      expect(toCanonicalQuery("キッズ　シャンプー")).toBe("キッズ シャンプー");
    });

    it("大文字を小文字に変換する", () => {
      expect(toCanonicalQuery("ABC")).toBe("abc");
      expect(toCanonicalQuery("SHAMPOO")).toBe("shampoo");
    });

    it("ひらがなをカタカナに変換する", () => {
      expect(toCanonicalQuery("きっず しゃんぷー")).toBe("キッズ シャンプー");
    });

    it("半角カタカナを全角に変換する", () => {
      expect(toCanonicalQuery("ｷｯｽﾞ ｼｬﾝﾌﾟｰ")).toBe("キッズ シャンプー");
    });

    it("半角カタカナの濁点・半濁点を合成する", () => {
      expect(toCanonicalQuery("ｶﾞｷﾞｸﾞ")).toBe("ガギグ");
      expect(toCanonicalQuery("ﾊﾟﾋﾟﾌﾟ")).toBe("パピプ");
    });

    it("連続空白を単一空白に正規化する", () => {
      expect(toCanonicalQuery("キッズ   シャンプー")).toBe("キッズ シャンプー");
    });

    it("前後の空白をトリムする", () => {
      expect(toCanonicalQuery("  キッズ シャンプー  ")).toBe("キッズ シャンプー");
    });

    it("長音符を正規化する", () => {
      // 様々な長音符を統一
      expect(toCanonicalQuery("シャンプ−")).toBe("シャンプー");
      expect(toCanonicalQuery("シャンプｰ")).toBe("シャンプー");
    });

    it("空文字列を処理できる", () => {
      expect(toCanonicalQuery("")).toBe("");
    });

    it("複合的な正規化を行う", () => {
      expect(toCanonicalQuery("ＡＢＣきっず　ｼｬﾝﾌﾟｰ")).toBe("abcキッズ シャンプー");
    });
  });

  describe("normalizeQuery with custom config", () => {
    it("カタカナをひらがなに変換できる", () => {
      const config = {
        ...DEFAULT_NORMALIZER_CONFIG,
        convertHiraganaToKatakana: false,
        convertKatakanaToHiragana: true,
      };
      expect(normalizeQuery("キッズ シャンプー", config)).toBe("きっず しゃんぷー");
    });

    it("句読点を除去できる", () => {
      const config = {
        ...DEFAULT_NORMALIZER_CONFIG,
        removePunctuation: true,
      };
      expect(normalizeQuery("シャンプー、リンス。", config)).toBe("シャンプーリンス");
    });

    it("長音符の正規化を無効にできる", () => {
      const config = {
        ...DEFAULT_NORMALIZER_CONFIG,
        normalizeLongVowelMark: false,
      };
      // 半角カタカナの長音符は全角に変換されるが、他の長音符は変換されない
      expect(normalizeQuery("シャンプｰ", config)).toBe("シャンプー");
    });
  });

  describe("_internal functions", () => {
    describe("convertFullwidthToHalfwidth", () => {
      it("全角数字を半角に変換する", () => {
        expect(_internal.convertFullwidthToHalfwidth("０１２３４５６７８９")).toBe("0123456789");
      });

      it("全角アルファベット大文字を半角小文字に変換する", () => {
        expect(_internal.convertFullwidthToHalfwidth("ＡＢＣＤＥ")).toBe("abcde");
      });

      it("全角アルファベット小文字を半角小文字に変換する", () => {
        expect(_internal.convertFullwidthToHalfwidth("ａｂｃｄｅ")).toBe("abcde");
      });
    });

    describe("convertHiraganaToKatakana", () => {
      it("ひらがなをカタカナに変換する", () => {
        expect(_internal.convertHiraganaToKatakana("あいうえお")).toBe("アイウエオ");
        expect(_internal.convertHiraganaToKatakana("かきくけこ")).toBe("カキクケコ");
        expect(_internal.convertHiraganaToKatakana("きっず")).toBe("キッズ");
      });

      it("カタカナはそのまま", () => {
        expect(_internal.convertHiraganaToKatakana("アイウエオ")).toBe("アイウエオ");
      });

      it("混合テキストを処理できる", () => {
        expect(_internal.convertHiraganaToKatakana("きっずシャンプー")).toBe("キッズシャンプー");
      });
    });

    describe("convertKatakanaToHiragana", () => {
      it("カタカナをひらがなに変換する", () => {
        expect(_internal.convertKatakanaToHiragana("アイウエオ")).toBe("あいうえお");
        expect(_internal.convertKatakanaToHiragana("カキクケコ")).toBe("かきくけこ");
      });

      it("ひらがなはそのまま", () => {
        expect(_internal.convertKatakanaToHiragana("あいうえお")).toBe("あいうえお");
      });
    });

    describe("normalizeWhitespace", () => {
      it("連続空白を単一空白に変換する", () => {
        expect(_internal.normalizeWhitespace("a   b")).toBe("a b");
      });

      it("前後の空白をトリムする", () => {
        expect(_internal.normalizeWhitespace("  a b  ")).toBe("a b");
      });

      it("タブや改行も処理する", () => {
        expect(_internal.normalizeWhitespace("a\t\nb")).toBe("a b");
      });
    });
  });
});
