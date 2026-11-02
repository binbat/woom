mod api;
mod config;
mod events;
mod helper;
mod log;
mod model;
mod proxy;
mod spa;
mod store;

use std::sync::Arc;

use api::AppState;
use config::Config;
use store::Store;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "woom=info,client_log=info,tower_http=info".into()),
        )
        .init();

    let cfg = Config::from_env().unwrap_or_else(|error| panic!("invalid configuration: {error}"));
    tracing::info!("{cfg:?}");

    let store = Arc::new(
        Store::open(&cfg.data_file)
            .await
            .unwrap_or_else(|error| panic!("failed to open data file: {error}")),
    );
    let state = AppState::new(store, events::new_bus(), cfg.clone());

    {
        let state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(15));
            loop {
                interval.tick().await;
                api::sweep(&state).await;
            }
        });
    }

    let app = api::router(state);
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", cfg.port))
        .await
        .expect("failed to bind port");
    tracing::info!("=== started on :{} ===", cfg.port);
    axum::serve(listener, app).await.expect("server error");
}
