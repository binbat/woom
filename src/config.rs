use std::fmt;
use std::path::PathBuf;

#[derive(Clone)]
pub struct Config {
    pub secret: String,
    pub port: String,
    pub live777_url: String,
    pub live777_token: String,
    pub log_read_token: Option<String>,
    pub data_file: PathBuf,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ConfigError {
    MissingSecret,
    WeakSecret,
    WeakLogReadToken,
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingSecret => write!(f, "SECRET must be set explicitly"),
            Self::WeakSecret => write!(
                f,
                "SECRET must be at least 32 bytes and not a known default"
            ),
            Self::WeakLogReadToken => write!(f, "LOG_READ_TOKEN must be at least 32 bytes"),
        }
    }
}

impl std::error::Error for ConfigError {}

impl fmt::Debug for Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Config")
            .field("secret", &"[REDACTED]")
            .field("port", &self.port)
            .field("live777_url", &self.live777_url)
            .field("live777_token", &"[REDACTED]")
            .field(
                "log_read_token",
                &self.log_read_token.as_ref().map(|_| "[REDACTED]"),
            )
            .field("data_file", &self.data_file)
            .finish()
    }
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    fn from_lookup<F>(lookup: F) -> Result<Self, ConfigError>
    where
        F: Fn(&str) -> Option<String>,
    {
        let secret = lookup("SECRET").ok_or(ConfigError::MissingSecret)?;
        let known_defaults = ["woom", "secret", "changeme", "change-me", "password"];
        if secret.trim().is_empty()
            || secret.len() < 32
            || known_defaults
                .iter()
                .any(|value| secret.eq_ignore_ascii_case(value))
        {
            return Err(ConfigError::WeakSecret);
        }

        let log_read_token = match lookup("LOG_READ_TOKEN") {
            Some(token) if token.is_empty() => None,
            Some(token) if token.trim().is_empty() || token.len() < 32 => {
                return Err(ConfigError::WeakLogReadToken)
            }
            Some(token) => Some(token),
            None => None,
        };
        let env = |key: &str, default: &str| lookup(key).unwrap_or_else(|| default.to_string());
        Ok(Self {
            secret,
            port: env("PORT", "4000"),
            live777_url: env("LIVE777_URL", "http://localhost:7777"),
            live777_token: env("LIVE777_TOKEN", ""),
            log_read_token,
            data_file: PathBuf::from(env("DATA_FILE", "./data/woom.json")),
        })
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn config(values: &[(&str, &str)]) -> Result<Config, ConfigError> {
        let values = values
            .iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect::<HashMap<_, _>>();
        Config::from_lookup(move |key| values.get(key).cloned())
    }

    #[test]
    fn secret_is_explicit_and_validated() {
        assert_eq!(config(&[]).err(), Some(ConfigError::MissingSecret));
        assert_eq!(
            config(&[("SECRET", "woom")]).err(),
            Some(ConfigError::WeakSecret)
        );
        assert_eq!(
            config(&[("SECRET", "short")]).err(),
            Some(ConfigError::WeakSecret)
        );
        assert!(config(&[("SECRET", "0123456789abcdef0123456789abcdef")]).is_ok());
    }

    #[test]
    fn log_read_token_is_optional_and_validated() {
        let secret = ("SECRET", "0123456789abcdef0123456789abcdef");
        assert_eq!(
            config(&[secret, ("LOG_READ_TOKEN", "short")]).err(),
            Some(ConfigError::WeakLogReadToken)
        );
        assert_eq!(
            config(&[secret, ("LOG_READ_TOKEN", "")])
                .unwrap()
                .log_read_token,
            None
        );
        let token = "log-read-secret-0123456789abcdef0123456789";
        assert_eq!(
            config(&[secret, ("LOG_READ_TOKEN", token)])
                .unwrap()
                .log_read_token
                .as_deref(),
            Some(token)
        );
    }

    #[test]
    fn defaults_and_debug_output_are_safe() {
        let cfg = config(&[
            ("SECRET", "0123456789abcdef0123456789abcdef"),
            ("LIVE777_TOKEN", "upstream-secret"),
            (
                "LOG_READ_TOKEN",
                "log-read-secret-0123456789abcdef0123456789",
            ),
        ])
        .unwrap();
        assert_eq!(cfg.data_file, PathBuf::from("./data/woom.json"));
        let debug = format!("{cfg:?}");
        assert!(!debug.contains("0123456789abcdef"));
        assert!(!debug.contains("upstream-secret"));
        assert!(!debug.contains("log-read-secret"));
        assert!(debug.contains("REDACTED"));
    }
}
