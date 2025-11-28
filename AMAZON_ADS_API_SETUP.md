# Amazon Ads API 設定ガイド

このドキュメントでは、Amazon 広告自動入札ツールを Amazon Ads API と連携させるための環境変数設定手順を説明します。

## 必要な環境変数

以下の環境変数を Cloud Run サービスに設定する必要があります：

### 1. AMAZON_ADS_CLIENT_ID
- **説明**: Amazon Ads API アプリケーションのクライアントID
- **取得方法**: Amazon Advertising Console でアプリケーションを登録して取得
- **例**: `amzn1.application-oa2-client.xxxxxxxxxxxxx`

### 2. AMAZON_ADS_CLIENT_SECRET
- **説明**: Amazon Ads API アプリケーションのクライアントシークレット
- **取得方法**: Amazon Advertising Console でアプリケーション登録時に表示される
- **注意**: シークレットは安全に保管し、決して公開リポジトリにコミットしないこと
- **例**: `xxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

### 3. AMAZON_ADS_REFRESH_TOKEN
- **説明**: Amazon Ads API のリフレッシュトークン
- **取得方法**: OAuth 2.0 フローで認証後に取得（Login with Amazon）
- **注意**: リフレッシュトークンは長期間有効だが、定期的に更新が必要な場合がある
- **例**: `Atzr|IwEBIxxxxxxxxxxxxxxxxxxxxxxx`

### 4. AMAZON_ADS_PROFILE_ID
- **説明**: Amazon Ads のプロフィールID（広告アカウントID）
- **取得方法**: Amazon Ads API の `/v2/profiles` エンドポイントで取得
- **例**: `1234567890`

### 5. AMAZON_ADS_API_BASE_URL（オプション）
- **説明**: Amazon Ads API のベースURL
- **デフォルト値**: `https://advertising-api.amazon.com`
- **注意**: 通常は設定不要。リージョンに応じて変更が必要な場合のみ設定
- **例**:
  - 北米: `https://advertising-api.amazon.com`
  - ヨーロッパ: `https://advertising-api-eu.amazon.com`
  - 極東: `https://advertising-api-fe.amazon.com`

---

## Cloud Run への環境変数設定

### 方法1: gcloud コマンドで一括設定

```bash
gcloud run services update amazon-bid-engine \
  --region asia-northeast1 \
  --project rpptool \
  --set-env-vars="\
AMAZON_ADS_CLIENT_ID=amzn1.application-oa2-client.xxxxxxxxxxxxx,\
AMAZON_ADS_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxx,\
AMAZON_ADS_REFRESH_TOKEN=Atzr|IwEBIxxxxxxxxxxxxxxxxxxxxxxx,\
AMAZON_ADS_PROFILE_ID=1234567890"
```

### 方法2: 個別に設定

```bash
# クライアントID
gcloud run services update amazon-bid-engine \
  --region asia-northeast1 \
  --project rpptool \
  --set-env-vars=AMAZON_ADS_CLIENT_ID=amzn1.application-oa2-client.xxxxxxxxxxxxx

# クライアントシークレット
gcloud run services update amazon-bid-engine \
  --region asia-northeast1 \
  --project rpptool \
  --set-env-vars=AMAZON_ADS_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# リフレッシュトークン
gcloud run services update amazon-bid-engine \
  --region asia-northeast1 \
  --project rpptool \
  --set-env-vars=AMAZON_ADS_REFRESH_TOKEN=Atzr|IwEBIxxxxxxxxxxxxxxxxxxxxxxx

# プロフィールID
gcloud run services update amazon-bid-engine \
  --region asia-northeast1 \
  --project rpptool \
  --set-env-vars=AMAZON_ADS_PROFILE_ID=1234567890
```

### 方法3: Secret Manager を使用（推奨：本番環境）

機密情報はより安全に管理するため、Google Secret Manager を使用することを推奨します。

```bash
# シークレットを作成
echo -n "xxxxxxxxxxxxxxxxxxxxxxxxxxxxx" | \
  gcloud secrets create amazon-ads-client-secret \
  --data-file=- \
  --project rpptool

echo -n "Atzr|IwEBIxxxxxxxxxxxxxxxxxxxxxxx" | \
  gcloud secrets create amazon-ads-refresh-token \
  --data-file=- \
  --project rpptool

# Cloud Run サービスに Secret Manager の参照を設定
gcloud run services update amazon-bid-engine \
  --region asia-northeast1 \
  --project rpptool \
  --set-secrets=AMAZON_ADS_CLIENT_SECRET=amazon-ads-client-secret:latest,\
AMAZON_ADS_REFRESH_TOKEN=amazon-ads-refresh-token:latest
```

---

## 環境変数の確認

設定後、以下のコマンドで環境変数が正しく設定されているか確認できます：

```bash
gcloud run services describe amazon-bid-engine \
  --region asia-northeast1 \
  --project rpptool \
  --format="value(spec.template.spec.containers[0].env)"
```

---

## Amazon Ads API 認証情報の取得手順

### ステップ1: Amazon Advertising Console でアプリケーションを登録

1. [Amazon Advertising Console](https://advertising.amazon.com/) にログイン
2. 右上のメニューから「設定」→「API」を選択
3. 「アプリケーションの登録」をクリック
4. 必要な情報を入力してアプリケーションを作成
5. **Client ID** と **Client Secret** をコピーして保存

### ステップ2: OAuth 2.0 認証フローでリフレッシュトークンを取得

1. 以下のURLでブラウザから認証を開始:
```
https://www.amazon.com/ap/oa?client_id=YOUR_CLIENT_ID&scope=advertising::campaign_management&response_type=code&redirect_uri=YOUR_REDIRECT_URI
```

2. Amazon アカウントでログインして認可
3. リダイレクトURLに付与された `code` パラメータを取得
4. 以下のAPIリクエストでアクセストークンとリフレッシュトークンを取得:

```bash
curl -X POST https://api.amazon.com/auth/o2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "code=YOUR_AUTHORIZATION_CODE" \
  -d "redirect_uri=YOUR_REDIRECT_URI" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET"
```

5. レスポンスから `refresh_token` を取得して保存

### ステップ3: プロフィールIDを取得

```bash
curl -X GET https://advertising-api.amazon.com/v2/profiles \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Amazon-Advertising-API-ClientId: YOUR_CLIENT_ID"
```

レスポンスから使用したい広告アカウントの `profileId` を取得

---

## トラブルシューティング

### エラー: "Failed to obtain access token"
- `AMAZON_ADS_CLIENT_ID`、`AMAZON_ADS_CLIENT_SECRET`、`AMAZON_ADS_REFRESH_TOKEN` が正しく設定されているか確認
- リフレッシュトークンが期限切れの場合は、再度 OAuth 認証フローを実行

### エラー: "AMAZON_ADS_PROFILE_ID is not configured"
- `AMAZON_ADS_PROFILE_ID` が環境変数に設定されているか確認
- プロフィールIDが正しいか確認（数値のみ）

### エラー: "Amazon Ads API request failed: 401 Unauthorized"
- アクセストークンが無効または期限切れ
- クライアントIDとシークレットが正しいか確認
- プロフィールIDが認証されたアカウントに紐づいているか確認

### エラー: "Amazon Ads API request failed: 403 Forbidden"
- 使用している Amazon Ads API アプリケーションに適切な権限がない
- プロフィールIDに対するアクセス権限がない

---

## 参考リンク

- [Amazon Ads API ドキュメント](https://advertising.amazon.com/API/docs/en-us)
- [Amazon Ads API 認証ガイド](https://advertising.amazon.com/API/docs/en-us/guides/authorization)
- [Google Cloud Secret Manager](https://cloud.google.com/secret-manager/docs)
