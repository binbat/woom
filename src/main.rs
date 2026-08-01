mod api;
mod config;
mod helper;
mod model;
mod proxy;
mod spa;

use config::Config;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "woom=info,tower_http=info".into()),
        )
        .init();

    let cfg = Config::from_env();
    tracing::info!("{:?}", cfg);

    let rdb = redis::Client::open(cfg.redis_url.as_str()).expect("invalid REDIS_URL");
    let rdb = redis::aio::ConnectionManager::new(rdb)
        .await
        .expect("failed to connect to redis");

    let app = api::router(rdb, cfg.clone());

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", cfg.port))
        .await
        .expect("failed to bind port");
    tracing::info!("=== started on :{} ===", cfg.port);
    axum::serve(listener, app).await.expect("server error");
}
