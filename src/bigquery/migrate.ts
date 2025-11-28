/**
 * BigQuery マイグレーションスクリプト
 * 新しいスキーマをデプロイするためのユーティリティ
 */

import { BigQuery } from '@google-cloud/bigquery';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../logger';

const SCHEMA_DIR = path.join(__dirname, 'schemas');

interface MigrationConfig {
  projectId: string;
  dataset: string;
  dryRun?: boolean;
}

/**
 * SQLファイルを読み込み、変数を置換
 */
function loadSqlFile(filename: string, config: MigrationConfig): string {
  const filepath = path.join(SCHEMA_DIR, filename);
  let sql = fs.readFileSync(filepath, 'utf-8');

  // プレースホルダーを置換
  sql = sql.replace(/\$\{PROJECT_ID\}/g, config.projectId);
  sql = sql.replace(/\$\{DATASET\}/g, config.dataset);

  return sql;
}

/**
 * SQLを個別のステートメントに分割
 */
function splitSqlStatements(sql: string): string[] {
  return sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));
}

/**
 * マイグレーション実行
 */
export async function runMigration(config: MigrationConfig): Promise<void> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  // スキーマファイルの実行順序（依存関係を考慮）
  const schemaFiles = [
    'product_strategy.sql',
    'daily_sales_by_product.sql',
    'daily_ads_by_product.sql',
    'keyword_stats_daily.sql',
    'jungle_scout_keywords.sql',
    'monthly_profit_by_product.sql',  // daily_*に依存
    'keyword_metrics_60d.sql',
    'seo_keywords_by_product.sql',
    'seo_score_by_product.sql',
  ];

  logger.info('Starting BigQuery migration', {
    projectId: config.projectId,
    dataset: config.dataset,
    dryRun: config.dryRun,
    schemaCount: schemaFiles.length,
  });

  // データセットが存在しない場合は作成
  const dataset = bigquery.dataset(config.dataset);
  const [exists] = await dataset.exists();

  if (!exists) {
    if (config.dryRun) {
      logger.info('[DRY RUN] Would create dataset', { dataset: config.dataset });
    } else {
      await bigquery.createDataset(config.dataset, {
        location: 'asia-northeast1',
      });
      logger.info('Created dataset', { dataset: config.dataset });
    }
  }

  // 各スキーマファイルを実行
  for (const filename of schemaFiles) {
    logger.info(`Processing schema: ${filename}`);

    try {
      const sql = loadSqlFile(filename, config);
      const statements = splitSqlStatements(sql);

      for (const statement of statements) {
        if (config.dryRun) {
          logger.info('[DRY RUN] Would execute SQL', {
            filename,
            preview: statement.substring(0, 100) + '...',
          });
        } else {
          await bigquery.query(statement);
          logger.info('Executed SQL statement', {
            filename,
            type: statement.includes('CREATE TABLE') ? 'CREATE TABLE' :
                  statement.includes('CREATE VIEW') ? 'CREATE VIEW' :
                  statement.includes('CREATE OR REPLACE VIEW') ? 'CREATE/REPLACE VIEW' :
                  'OTHER',
          });
        }
      }
    } catch (error) {
      logger.error(`Failed to process schema: ${filename}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  logger.info('Migration completed successfully');
}

/**
 * CLI実行用
 */
async function main() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const dataset = process.env.BIGQUERY_DATASET || 'amazon_bid_engine';
  const dryRun = process.argv.includes('--dry-run');

  if (!projectId) {
    console.error('Error: GOOGLE_CLOUD_PROJECT_ID environment variable is required');
    process.exit(1);
  }

  await runMigration({
    projectId,
    dataset,
    dryRun,
  });
}

// CLI実行時のみmainを実行
if (require.main === module) {
  main().catch(console.error);
}
