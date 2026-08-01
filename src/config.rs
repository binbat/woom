#[derive(Clone, Debug)]
pub struct Config {
    pub secret: String,
    pub port: String,
    pub live777_url: String,
    pub live777_token: String,
}

impl Config {
    pub fn from_env() -> Self {
        fn env(key: &str, default: &str) -> String {
            std::env::var(key).unwrap_or_else(|_| default.to_string())
        }
        Config {
            secret: env("SECRET", "woom"),
            port: env("PORT", "4000"),
            live777_url: env("LIVE777_URL", "http://localhost:7777"),
            live777_token: env("LIVE777_TOKEN", ""),
        }
    }
}
