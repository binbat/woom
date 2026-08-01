use axum::{
    body::{Body, Bytes},
    extract::{OriginalUri, State},
    http::{header, HeaderName, Method, StatusCode},
    response::{IntoResponse, Response},
};

use crate::api::AppState;

// Hop-by-hop headers (RFC 7230 6.1) plus content-length, which hyper
// recomputes from the forwarded body.
const STRIPPED_RESPONSE_HEADERS: [HeaderName; 5] = [
    header::CONNECTION,
    HeaderName::from_static("keep-alive"),
    header::TRANSFER_ENCODING,
    header::UPGRADE,
    header::CONTENT_LENGTH,
];

pub async fn forward(
    State(state): State<AppState>,
    method: Method,
    OriginalUri(uri): OriginalUri,
    headers: axum::http::HeaderMap,
    body: Bytes,
) -> Response {
    let url = format!(
        "{}{}",
        state.cfg.live777_url.trim_end_matches('/'),
        uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("/")
    );

    let mut req = state.http.request(method, &url).body(body);
    for h in [header::CONTENT_TYPE, header::ACCEPT] {
        if let Some(v) = headers.get(&h) {
            req = req.header(h, v);
        }
    }
    if !state.cfg.live777_token.is_empty() {
        req = req.bearer_auth(&state.cfg.live777_token);
    }

    match req.send().await {
        Ok(resp) => {
            let status = StatusCode::from_u16(resp.status().as_u16())
                .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            let mut builder = Response::builder().status(status);
            for (k, v) in resp.headers() {
                if !STRIPPED_RESPONSE_HEADERS.contains(k) {
                    builder = builder.header(k, v);
                }
            }
            let body = resp.bytes().await.unwrap_or_default();
            builder
                .body(Body::from(body))
                .expect("valid response parts")
                .into_response()
        }
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}
