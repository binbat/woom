use axum::{
    extract::OriginalUri,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use rust_embed::RustEmbed;

// Requires the webapp build output: `npm run build` produces static/dist.
#[derive(RustEmbed)]
#[folder = "static/dist"]
struct Assets;

/// Serve the embedded webapp; unknown paths fall back to index.html (SPA).
pub async fn handler(OriginalUri(uri): OriginalUri) -> Response {
    let path = uri.path().trim_start_matches('/');
    serve(if path.is_empty() { "index.html" } else { path })
}

fn serve(path: &str) -> Response {
    match Assets::get(path) {
        Some(content) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            ([(header::CONTENT_TYPE, mime.as_ref())], content.data).into_response()
        }
        None if path != "index.html" => serve("index.html"),
        None => (StatusCode::NOT_FOUND, "not found").into_response(),
    }
}
