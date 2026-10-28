use super::*;
use crate::models::credits::Credits;
use crate::services::feature_flag_service as flags;
use serde_json::{Value, json};

const VIEW: &str = "/api/v1/billing/wallet/view";
const LEGACY: &str = "/api/v1/billing/wallet";

fn mounted_app(state: &crate::AppState) -> Router {
    let (_, private) = crate::routes::build_router_with_state(state.clone());
    private.with_state(state.clone())
}

async fn read(app: &Router, path: &str, token: Option<&str>) -> (StatusCode, Value) {
    let mut request = Request::builder().uri(path);
    if let Some(token) = token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let body = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
    (status, serde_json::from_slice(&body).unwrap())
}

async fn insert_wallet(db: &mongodb::Database, owner: &str) -> BillingWallet {
    let now = Utc::now();
    let wallet = BillingWallet {
        id: Uuid::new_v4().to_string(),
        owner_id: owner.into(),
        lago_customer_id: owner.into(),
        lago_wallet_id: Some("existing-wallet".into()),
        lago_subscription_id: None,
        plan_kind: PlanKind::Prepaid,
        balance_credits: "10.123456789012".parse().unwrap(),
        reserved_credits: "1.000000000001".parse().unwrap(),
        pending_lago_debits: "2.000000000002".parse().unwrap(),
        pending_topup_expiry_credits: "0.000000000003".parse().unwrap(),
        has_payment_instrument: false,
        overdraft_cap_credits: Credits::from_whole(5),
        suspended: false,
        collection_state: CollectionState::Good,
        topup_expiry_checked_at: None,
        active_topup_expiry: None,
        balance_synced_at: now,
        created_at: now,
        updated_at: now,
    };
    db.collection::<BillingWallet>(BILLING_WALLET)
        .insert_one(&wallet)
        .await
        .unwrap();
    wallet
}

#[tokio::test]
async fn billing_wallet_view_existing_matches_legacy_without_mutation() {
    let db = connect_test_database("wallet_view_existing").await.unwrap();
    let owner = insert_owner(&db).await;
    let lago = Arc::new(FakeLago::default());
    let state = billing_route_state(db.clone(), lago.clone(), 0);
    let wallet = insert_wallet(&db, &owner).await;
    let token = route_access_token(&state, &owner);
    let app = mounted_app(&state);
    let (status, body) = read(&app, VIEW, Some(&token)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["owner_id"], owner);
    assert_eq!(body["balance"], "10.123456789012");
    assert_eq!(body["available"], "7.123456789006");
    assert_eq!(body["available_with_overdraft"], "12.123456789006");
    assert_eq!(body["created"], false);
    assert!(body.get("_id").is_none(), "must serialize the response DTO");
    assert_eq!(read(&app, LEGACY, Some(&token)).await, (status, body));
    let stored = db
        .collection::<BillingWallet>(BILLING_WALLET)
        .find_one(doc! { "_id": &wallet.id })
        .await
        .unwrap()
        .unwrap();
    // MongoDB timestamps have millisecond precision.
    assert_eq!(
        bson::to_document(&stored).unwrap(),
        bson::to_document(&wallet).unwrap()
    );
    assert_eq!(lago.wallet_creates.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn billing_wallet_view_absent_returns_null_and_never_provisions() {
    let db = connect_test_database("wallet_view_absent").await.unwrap();
    let owner = insert_owner(&db).await;
    let stranger = insert_owner(&db).await;
    insert_wallet(&db, &stranger).await;
    let lago = Arc::new(FakeLago::default());
    let state = billing_route_state(db.clone(), lago.clone(), 0);
    let token = route_access_token(&state, &owner);
    let app = mounted_app(&state);
    let wallets = db.collection::<BillingWallet>(BILLING_WALLET);
    let before = wallets.count_documents(doc! {}).await.unwrap();
    assert_eq!(before, 1);
    for _ in 0..3 {
        assert_eq!(
            read(&app, VIEW, Some(&token)).await,
            (StatusCode::OK, Value::Null)
        );
    }
    assert_eq!(wallets.count_documents(doc! {}).await.unwrap(), before);
    assert!(
        wallets
            .find_one(doc! { "owner_id": &owner })
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(lago.wallet_creates.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn billing_wallet_view_requires_auth_and_preserves_credential_restrictions() {
    let db = connect_test_database("wallet_view_auth").await.unwrap();
    let owner = insert_owner(&db).await;
    let state = billing_route_state(db.clone(), Arc::new(FakeLago::default()), 0);
    let token = route_access_token(&state, &owner);
    let mut claims = serde_json::to_value(
        crate::crypto::jwt::verify_token(&state.jwt_keys, &state.config, &token).unwrap(),
    )
    .unwrap();
    claims["scope"] = json!("account:read");
    claims["delegated"] = json!(true);
    claims["act"] = json!({"sub": Uuid::new_v4().to_string()});
    let delegated = jsonwebtoken::encode(
        &jsonwebtoken::decode_header(&token).unwrap(),
        &claims,
        &state.jwt_keys.encoding,
    )
    .unwrap();
    let app = mounted_app(&state);
    for path in [VIEW, LEGACY] {
        assert_eq!(read(&app, path, None).await.0, StatusCode::UNAUTHORIZED);
        assert_eq!(
            read(&app, path, Some("invalid")).await.0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            read(&app, path, Some(&delegated)).await.0,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            read(&app, path, Some("nyxid_ag_test")).await.0,
            StatusCode::FORBIDDEN
        );
        let request = Request::builder()
            .uri(path)
            .header("x-api-key", "nyxid_ag_test")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.clone().oneshot(request).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
    }
    assert_eq!(
        db.collection::<BillingWallet>(BILLING_WALLET)
            .count_documents(doc! {})
            .await
            .unwrap(),
        0
    );
}

#[tokio::test]
async fn billing_wallet_view_preserves_disabled_rollout_behavior() {
    let db = connect_test_database("wallet_view_rollout").await.unwrap();
    let owner = insert_owner(&db).await;
    let lago = Arc::new(FakeLago::default());
    let state = billing_route_state(db.clone(), lago.clone(), 0);
    let token = route_access_token(&state, &owner);
    let app = mounted_app(&state);
    flags::set_platform_override(
        &db,
        flags::BILLING_FLAG_KEY,
        &flags::FlagTarget::Global,
        false,
        &owner,
    )
    .await
    .unwrap();
    let legacy = read(&app, LEGACY, Some(&token)).await;
    assert_eq!(legacy.0, StatusCode::FORBIDDEN);
    assert_eq!(read(&app, VIEW, Some(&token)).await, legacy);
    assert_eq!(
        db.collection::<BillingWallet>(BILLING_WALLET)
            .count_documents(doc! {})
            .await
            .unwrap(),
        0
    );
    insert_wallet(&db, &owner).await;
    assert_eq!(read(&app, VIEW, Some(&token)).await, legacy);
    assert_eq!(lago.wallet_creates.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn billing_wallet_view_without_lago_or_charging_reads_existing_or_null() {
    let db = connect_test_database("wallet_view_disabled").await.unwrap();
    let owner = insert_owner(&db).await;
    let absent = insert_owner(&db).await;
    insert_wallet(&db, &owner).await;
    // Like the legacy GET, an existing wallet stays readable when charging is off.
    let state = test_app_state_with_config(db.clone(), test_app_config());
    assert!(!state.billing.billing_enabled());
    assert!(!state.billing.lago_configured());
    let token = route_access_token(&state, &owner);
    let app = mounted_app(&state);
    let legacy = read(&app, LEGACY, Some(&token)).await;
    assert_eq!(legacy.0, StatusCode::OK);
    assert_eq!(read(&app, VIEW, Some(&token)).await, legacy);
    let absent_token = route_access_token(&state, &absent);
    assert_eq!(
        read(&app, VIEW, Some(&absent_token)).await,
        (StatusCode::OK, Value::Null)
    );
    assert_eq!(
        db.collection::<BillingWallet>(BILLING_WALLET)
            .count_documents(doc! {})
            .await
            .unwrap(),
        1
    );
}
