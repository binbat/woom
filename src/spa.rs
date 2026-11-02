use axum::{
    extract::OriginalUri,
    http::{header, HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
};
use rust_embed::RustEmbed;

// Requires the webapp build output: `npm run build` produces static/dist.
#[derive(RustEmbed)]
#[folder = "static/dist"]
struct Assets;

pub async fn handler(
    method: Method,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    if Assets::get(path).is_some() {
        return serve(path);
    }

    let accepts_html = headers
        .get(header::ACCEPT)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value.split(',').any(|mime| {
                mime.trim()
                    .split(';')
                    .next()
                    .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("text/html"))
            })
        });
    let api_path = ["room", "user", "whip", "whep", "api", "log", "session"]
        .iter()
        .any(|prefix| path == *prefix || path.starts_with(&format!("{prefix}/")));
    let asset_path = std::path::Path::new(path).extension().is_some();
    if matches!(method, Method::GET | Method::HEAD) && accepts_html && !api_path && !asset_path {
        serve("index.html")
    } else {
        StatusCode::NOT_FOUND.into_response()
    }
}

fn serve(path: &str) -> Response {
    match Assets::get(path) {
        Some(content) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            ([(header::CONTENT_TYPE, mime.as_ref())], content.data).into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}
