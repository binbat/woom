mod api;
mod config;
mod events;
mod helper;
mod model;
mod proxy;
mod spa;
mod store;

use std::sync::Arc;

use config::Config;
use store::{MemoryStore, Store, PRESENCE_TTL_SECS};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "woom=info,client_log=info,tower_http=info".into()),
        )
        .init();

    let cfg = Config::from_env();
    tracing::info!("{:?}", cfg);

    let store: Arc<dyn Store> = Arc::new(MemoryStore::new());
    let bus = events::new_bus();

    // presence sweeper: clients heartbeat every 15s; entries older than the
    // TTL (crashed tabs, lost connections) are removed and broadcast
    {
        let store = store.clone();
        let bus = bus.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(15));
            loop {
                interval.tick().await;
                for room_id in store.sweep_presence(PRESENCE_TTL_SECS).await {
                    events::publish_room(&store, &bus, &room_id).await;
                }
            }
        });
    }

    let app = api::router(store, bus, cfg.clone());

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", cfg.port))
        .await
        .expect("failed to bind port");
    tracing::info!("=== started on :{} ===", cfg.port);
    axum::serve(listener, app).await.expect("server error");
}
