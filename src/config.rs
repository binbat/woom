use std::fmt;
use std::path::PathBuf;

#[derive(Clone)]
pub struct Config {
    pub secret: String,
    pub port: String,
    pub live777_url: String,
    pub live777_token: String,
    pub log_read_token: Option<String>,
    pub caption_token: Option<String>,
    pub minutes_url: Option<String>,
    pub minutes_model: Option<String>,
    pub minutes_api_key: Option<String>,
    pub admin_user: Option<String>,
    pub admin_password: Option<String>,
    pub events_cable: bool,
    pub data_file: PathBuf,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ConfigError {
    MissingSecret,
    WeakSecret,
    WeakLogReadToken,
    WeakCaptionToken,
    WeakMinutesConfig,
    WeakAdminConfig,
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
            Self::WeakCaptionToken => write!(f, "CAPTION_TOKEN must be at least 32 bytes"),
            Self::WeakMinutesConfig => {
                write!(f, "MINUTES_MODEL must be set when MINUTES_URL is set")
            }
            Self::WeakAdminConfig => write!(
                f,
                "ADMIN_USER and ADMIN_PASSWORD must be set together, with a password of at least 16 bytes"
            ),
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
            .field(
                "caption_token",
                &self.caption_token.as_ref().map(|_| "[REDACTED]"),
            )
            .field("minutes_url", &self.minutes_url)
            .field("minutes_model", &self.minutes_model)
            .field(
                "minutes_api_key",
                &self.minutes_api_key.as_ref().map(|_| "[REDACTED]"),
            )
            .field("admin_user", &self.admin_user)
            .field(
                "admin_password",
                &self.admin_password.as_ref().map(|_| "[REDACTED]"),
            )
            .field("events_cable", &self.events_cable)
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
        let caption_token = match lookup("CAPTION_TOKEN") {
            Some(token) if token.is_empty() => None,
            Some(token) if token.trim().is_empty() || token.len() < 32 => {
                return Err(ConfigError::WeakCaptionToken)
            }
            Some(token) => Some(token),
            None => None,
        };
        let minutes_url = match lookup("MINUTES_URL") {
            Some(url) if url.trim().is_empty() => None,
            Some(url) => Some(url),
            None => None,
        };
        let minutes_model = match lookup("MINUTES_MODEL") {
            Some(model) if model.trim().is_empty() => None,
            Some(model) => Some(model),
            None => None,
        };
        if minutes_url.is_some() && minutes_model.is_none() {
            return Err(ConfigError::WeakMinutesConfig);
        }
        let minutes_api_key = match lookup("MINUTES_API_KEY") {
            Some(key) if key.is_empty() => None,
            Some(key) => Some(key),
            None => None,
        };
        let admin_user = match lookup("ADMIN_USER") {
            Some(user) if user.is_empty() => None,
            Some(user) if user.trim().is_empty() => return Err(ConfigError::WeakAdminConfig),
            Some(user) => Some(user),
            None => None,
        };
        let admin_password = match lookup("ADMIN_PASSWORD") {
            Some(password) if password.is_empty() => None,
            Some(password) if password.trim().is_empty() || password.len() < 16 => {
                return Err(ConfigError::WeakAdminConfig)
            }
            Some(password) => Some(password),
            None => None,
        };
        if admin_user.is_some() != admin_password.is_some() {
            return Err(ConfigError::WeakAdminConfig);
        }
        let events_cable = lookup("EVENTS_CABLE").is_some_and(|value| {
            !value.is_empty()
                && !value.eq_ignore_ascii_case("0")
                && !value.eq_ignore_ascii_case("false")
        });
        let env = |key: &str, default: &str| lookup(key).unwrap_or_else(|| default.to_string());
        Ok(Self {
            secret,
            port: env("PORT", "4000"),
            live777_url: env("LIVE777_URL", "http://localhost:7777"),
            live777_token: env("LIVE777_TOKEN", ""),
            log_read_token,
            caption_token,
            minutes_url,
            minutes_model,
            minutes_api_key,
            admin_user,
            admin_password,
            events_cable,
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
    fn caption_token_is_optional_and_validated() {
        let secret = ("SECRET", "0123456789abcdef0123456789abcdef");
        assert_eq!(
            config(&[secret, ("CAPTION_TOKEN", "short")]).err(),
            Some(ConfigError::WeakCaptionToken)
        );
        assert_eq!(
            config(&[secret, ("CAPTION_TOKEN", "")])
                .unwrap()
                .caption_token,
            None
        );
        let token = "caption-token-0123456789abcdef0123456789";
        assert_eq!(
            config(&[secret, ("CAPTION_TOKEN", token)])
                .unwrap()
                .caption_token
                .as_deref(),
            Some(token)
        );
    }

    #[test]
    fn minutes_config_is_optional_and_requires_a_model() {
        let secret = ("SECRET", "0123456789abcdef0123456789abcdef");
        let cfg = config(&[secret]).unwrap();
        assert_eq!(cfg.minutes_url, None);
        assert_eq!(cfg.minutes_model, None);
        assert_eq!(cfg.minutes_api_key, None);

        let cfg = config(&[secret, ("MINUTES_URL", ""), ("MINUTES_MODEL", "ignored")]).unwrap();
        assert_eq!(cfg.minutes_url, None);
        assert_eq!(cfg.minutes_model, Some("ignored".to_string()));
        let cfg = config(&[secret, ("MINUTES_URL", "  ")]).unwrap();
        assert_eq!(cfg.minutes_url, None);

        assert_eq!(
            config(&[secret, ("MINUTES_URL", "http://localhost:11434/v1")]).err(),
            Some(ConfigError::WeakMinutesConfig)
        );
        assert_eq!(
            config(&[
                secret,
                ("MINUTES_URL", "http://localhost:11434/v1"),
                ("MINUTES_MODEL", "  ")
            ])
            .err(),
            Some(ConfigError::WeakMinutesConfig)
        );

        let cfg = config(&[
            secret,
            ("MINUTES_URL", "http://localhost:11434/v1"),
            ("MINUTES_MODEL", "qwen3"),
        ])
        .unwrap();
        assert_eq!(
            cfg.minutes_url.as_deref(),
            Some("http://localhost:11434/v1")
        );
        assert_eq!(cfg.minutes_model.as_deref(), Some("qwen3"));
        assert_eq!(cfg.minutes_api_key, None);
        let cfg = config(&[
            secret,
            ("MINUTES_URL", "http://localhost:11434/v1"),
            ("MINUTES_MODEL", "qwen3"),
            ("MINUTES_API_KEY", "minutes-key"),
        ])
        .unwrap();
        assert_eq!(cfg.minutes_api_key.as_deref(), Some("minutes-key"));
        let cfg = config(&[
            secret,
            ("MINUTES_URL", "http://localhost:11434/v1"),
            ("MINUTES_MODEL", "qwen3"),
            ("MINUTES_API_KEY", ""),
        ])
        .unwrap();
        assert_eq!(cfg.minutes_api_key, None);
    }

    #[test]
    fn admin_credentials_are_optional_and_paired() {
        let secret = ("SECRET", "0123456789abcdef0123456789abcdef");
        let cfg = config(&[secret]).unwrap();
        assert_eq!(cfg.admin_user, None);
        assert_eq!(cfg.admin_password, None);

        // Empty strings mean unset.
        let cfg = config(&[secret, ("ADMIN_USER", ""), ("ADMIN_PASSWORD", "")]).unwrap();
        assert_eq!(cfg.admin_user, None);
        assert_eq!(cfg.admin_password, None);

        // Both must be set together.
        assert_eq!(
            config(&[secret, ("ADMIN_USER", "admin")]).err(),
            Some(ConfigError::WeakAdminConfig)
        );
        assert_eq!(
            config(&[secret, ("ADMIN_PASSWORD", "0123456789abcdef")]).err(),
            Some(ConfigError::WeakAdminConfig)
        );

        // Blank user / short or blank password are rejected.
        for (user, password) in [
            ("  ", "0123456789abcdef"),
            ("admin", "   "),
            ("admin", "short"),
        ] {
            assert_eq!(
                config(&[secret, ("ADMIN_USER", user), ("ADMIN_PASSWORD", password)]).err(),
                Some(ConfigError::WeakAdminConfig)
            );
        }

        let cfg = config(&[
            secret,
            ("ADMIN_USER", "admin"),
            ("ADMIN_PASSWORD", "0123456789abcdef"),
        ])
        .unwrap();
        assert_eq!(cfg.admin_user.as_deref(), Some("admin"));
        assert_eq!(cfg.admin_password.as_deref(), Some("0123456789abcdef"));
    }

    #[test]
    fn events_cable_is_an_opt_in_boolean() {
        let secret = ("SECRET", "0123456789abcdef0123456789abcdef");
        assert!(!config(&[secret]).unwrap().events_cable);
        for disabled in ["", "0", "false", "FALSE", "False"] {
            assert!(
                !config(&[secret, ("EVENTS_CABLE", disabled)])
                    .unwrap()
                    .events_cable
            );
        }
        for enabled in ["1", "true", "yes", "on"] {
            assert!(
                config(&[secret, ("EVENTS_CABLE", enabled)])
                    .unwrap()
                    .events_cable
            );
        }
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
            ("CAPTION_TOKEN", "caption-secret-0123456789abcdef0123456789"),
            ("MINUTES_URL", "http://localhost:11434/v1"),
            ("MINUTES_MODEL", "qwen3"),
            ("MINUTES_API_KEY", "minutes-secret-key"),
            ("ADMIN_USER", "admin"),
            ("ADMIN_PASSWORD", "admin-secret-password"),
        ])
        .unwrap();
        assert_eq!(cfg.data_file, PathBuf::from("./data/woom.json"));
        let debug = format!("{cfg:?}");
        assert!(!debug.contains("0123456789abcdef"));
        assert!(!debug.contains("upstream-secret"));
        assert!(!debug.contains("log-read-secret"));
        assert!(!debug.contains("caption-secret"));
        assert!(!debug.contains("minutes-secret-key"));
        assert!(!debug.contains("admin-secret-password"));
        assert!(debug.contains("admin"));
        assert!(debug.contains("qwen3"));
        assert!(debug.contains("REDACTED"));
    }
}
