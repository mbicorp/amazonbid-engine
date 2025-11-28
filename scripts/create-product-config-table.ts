/**
 * product_config テーブルを作成するスクリプト
 *
 * 実行方法: npx ts-node scripts/create-product-config-table.ts
 */

import { BigQuery } from "@google-cloud/bigquery";

const PROJECT_ID = "rpptool";
const DATASET = "amazon_bid_engine";
const TABLE_NAME = "product_config";

// サービスアカウントキーのパス
const KEY_FILE = "c:\\Users\\yosuk\\Downloads\\rpptool-87297ca02a0c.json";

async function main() {
  const bigquery = new BigQuery({
    projectId: PROJECT_ID,
    keyFilename: KEY_FILE,
  });

  const schema = [
    { name: "asin", type: "STRING", mode: "REQUIRED" },
    { name: "is_active", type: "BOOL", mode: "REQUIRED" },
    { name: "revenue_model", type: "STRING", mode: "REQUIRED" },
    { name: "lifecycle_state", type: "STRING", mode: "REQUIRED" },
    { name: "margin_rate", type: "FLOAT64", mode: "NULLABLE" },
    { name: "expected_repeat_orders_assumed", type: "FLOAT64", mode: "NULLABLE" },
    { name: "launch_date", type: "DATE", mode: "NULLABLE" },
    { name: "created_at", type: "DATETIME", mode: "REQUIRED" },
    { name: "updated_at", type: "DATETIME", mode: "REQUIRED" },
  ];

  try {
    const dataset = bigquery.dataset(DATASET);
    const table = dataset.table(TABLE_NAME);

    // テーブルが存在するか確認
    const [exists] = await table.exists();
    if (exists) {
      console.log(`Table ${TABLE_NAME} already exists.`);
      return;
    }

    // テーブル作成
    await dataset.createTable(TABLE_NAME, { schema });
    console.log(`Table ${TABLE_NAME} created successfully.`);
  } catch (error) {
    console.error("Error creating table:", error);
    process.exit(1);
  }
}

main();
