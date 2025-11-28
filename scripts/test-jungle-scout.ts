/**
 * Jungle Scout API 動作確認スクリプト
 */

import * as dotenv from "dotenv";
dotenv.config();

import { createJungleScoutClient } from "../src/jungle-scout/client";

async function testJungleScoutApi() {
  console.log("=== Jungle Scout API 動作確認 ===\n");

  // APIキーの確認
  const apiKey = process.env.JUNGLE_SCOUT_API_KEY;
  if (!apiKey) {
    console.error("❌ JUNGLE_SCOUT_API_KEY が設定されていません");
    process.exit(1);
  }
  console.log("✅ APIキーが設定されています\n");

  try {
    // クライアント作成
    const client = createJungleScoutClient();
    console.log("✅ クライアント作成成功\n");

    // テスト用ASIN（Amazon Japan の人気商品）
    // B0BVMFLX3B: Amazon Echo Dot 第5世代
    const testAsin = "B0BVMFLX3B";

    console.log(`📊 ASIN ${testAsin} のキーワードを取得中...\n`);

    // Keywords by ASIN を試す
    const keywords = await client.getKeywordsByAsin({
      asin: testAsin,
      marketplace: "jp",
      page_size: 5, // テストなので5件だけ
    });

    if (keywords.length > 0) {
      console.log(`✅ ${keywords.length} 件のキーワードを取得しました:\n`);
      keywords.forEach((kw, i) => {
        console.log(`  ${i + 1}. ${kw.attributes.name}`);
        console.log(`     検索ボリューム: ${kw.attributes.monthly_search_volume_exact.toLocaleString()}`);
        console.log(`     PPC入札額: ¥${kw.attributes.ppc_bid_exact}`);
        console.log("");
      });
    } else {
      console.log("⚠️ キーワードが見つかりませんでした（ASINを変えて試してください）");
    }

    console.log("🎉 Jungle Scout API 接続成功！");

  } catch (error) {
    console.error("❌ APIエラー:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

testJungleScoutApi();
