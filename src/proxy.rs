use axum::{
    body::{Body, Bytes},
    extract::{Extension, OriginalUri, State},
    http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
};

use crate::{
    api::{AppState, UserId},
    store::MediaGrant,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct MediaSession {
    pub user_id: String,
    pub stream_id: String,
    pub kind: String,
    pub room_id: String,
    pub meeting_no: String,
    pub resource: String,
}

#[derive(Debug)]
struct RewrittenLocation {
    value: HeaderValue,
    session_path: Option<String>,
    session_resource: Option<String>,
}

fn connection_headers(headers: &HeaderMap) -> Vec<HeaderName> {
    headers
        .get_all(header::CONNECTION)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .filter_map(|name| HeaderName::from_bytes(name.trim().as_bytes()).ok())
        .collect()
}

fn stripped(name: &HeaderName, connection: &[HeaderName], request: bool) -> bool {
    matches!(
        *name,
        header::CONNECTION
            | header::HOST
            | header::CONTENT_LENGTH
            | header::TRANSFER_ENCODING
            | header::UPGRADE
            | header::PROXY_AUTHENTICATE
            | header::PROXY_AUTHORIZATION
            | header::TE
            | header::TRAILER
    ) || name.as_str().eq_ignore_ascii_case("keep-alive")
        || name.as_str().eq_ignore_ascii_case("proxy-connection")
        || (request && name == header::AUTHORIZATION)
        || connection.contains(name)
}

fn rewritten_location(
    value: &HeaderValue,
    upstream_url: &reqwest::Url,
) -> Option<RewrittenLocation> {
    let location = value.to_str().ok()?;
    let url = upstream_url.join(location).ok()?;
    let mut resource = url.path().to_string();
    if let Some(query) = url.query() {
        resource.push('?');
        resource.push_str(query);
    }
    if !(url.path().starts_with("/whip/")
        || url.path().starts_with("/whep/")
        || url.path().starts_with("/session/"))
    {
        return None;
    }
    let session_path = url
        .path()
        .starts_with("/session/")
        .then(|| url.path().to_string());
    let session_resource = session_path.as_ref().map(|_| resource.clone());
    if let Some(fragment) = url.fragment() {
        resource.push('#');
        resource.push_str(fragment);
    }
    Some(RewrittenLocation {
        value: HeaderValue::from_str(&resource).ok()?,
        session_path,
        session_resource,
    })
}

async fn authorize(
    state: &AppState,
    kind: &str,
    user_id: &str,
    stream_id: &str,
) -> Option<MediaGrant> {
    match kind {
        "whip" => state.store.whip_authorization(user_id, stream_id).await,
        "whep" => state.store.whep_authorization(user_id, stream_id).await,
        _ => None,
    }
}

fn same_grant(session: &MediaSession, grant: &MediaGrant) -> bool {
    session.room_id == grant.room_id && session.meeting_no == grant.meeting_no
}

async fn register_media_session(
    state: &AppState,
    path: String,
    session: MediaSession,
) -> Result<Vec<MediaSession>, Box<MediaSession>> {
    let _guard = state.write_gate.lock().await;
    let grant = authorize(state, &session.kind, &session.user_id, &session.stream_id).await;
    if grant
        .as_ref()
        .is_none_or(|grant| !same_grant(&session, grant))
    {
        return Err(Box::new(session));
    }

    let mut replaced = Vec::new();
    let mut sessions = state.media_sessions.lock().await;
    sessions.retain(|existing_path, existing| {
        let replace = *existing_path != path
            && existing.room_id == session.room_id
            && existing.user_id == session.user_id
            && existing.stream_id == session.stream_id
            && existing.kind == session.kind;
        if replace {
            replaced.push(existing.clone());
        }
        !replace
    });
    sessions.insert(path, session);
    Ok(replaced)
}

pub(crate) async fn take_media_sessions(
    state: &AppState,
    room_id: &str,
    user_id: Option<&str>,
) -> Vec<MediaSession> {
    let mut removed = Vec::new();
    state.media_sessions.lock().await.retain(|_, session| {
        let matches =
            session.room_id == room_id && user_id.is_none_or(|user_id| session.user_id == user_id);
        if matches {
            removed.push(session.clone());
        }
        !matches
    });
    removed
}

pub(crate) async fn take_invalid_media_sessions(state: &AppState) -> Vec<MediaSession> {
    let _guard = state.write_gate.lock().await;
    let existing = state
        .media_sessions
        .lock()
        .await
        .iter()
        .map(|(path, session)| (path.clone(), session.clone()))
        .collect::<Vec<_>>();
    let mut removed = Vec::new();
    for (path, session) in existing {
        let grant = authorize(state, &session.kind, &session.user_id, &session.stream_id).await;
        if grant
            .as_ref()
            .is_some_and(|grant| same_grant(&session, grant))
        {
            continue;
        }
        let mut sessions = state.media_sessions.lock().await;
        if sessions.get(&path) == Some(&session) {
            sessions.remove(&path);
            removed.push(session);
        }
    }
    removed
}

pub(crate) async fn revoke_media_sessions(state: &AppState, sessions: Vec<MediaSession>) {
    for session in sessions {
        let url = format!(
            "{}{}",
            state.cfg.live777_url.trim_end_matches('/'),
            session.resource
        );
        let mut request = state.http.delete(url);
        if !state.cfg.live777_token.is_empty() {
            request = request.bearer_auth(&state.cfg.live777_token);
        }
        match request.send().await {
            Ok(response) if response.status().is_success() || response.status() == 404 => {}
            Ok(response) => tracing::warn!(
                "Live777 media revocation for {} returned {}",
                session.resource,
                response.status()
            ),
            Err(error) => {
                tracing::warn!(
                    "Live777 media revocation for {} failed: {error}",
                    session.resource
                )
            }
        }
    }
}

pub async fn forward(
    State(state): State<AppState>,
    Extension(user): Extension<UserId>,
    method: Method,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let resource = uri
        .path_and_query()
        .map(|value| value.as_str())
        .unwrap_or("/");
    let mut segments = uri.path().split('/').filter(|segment| !segment.is_empty());
    let Some(route_kind) = segments.next() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let (kind, stream_id, existing_session) = if route_kind == "session" {
        let session = state.media_sessions.lock().await.get(uri.path()).cloned();
        let Some(session) = session else {
            return (StatusCode::FORBIDDEN, "media session is not authorized").into_response();
        };
        if session.user_id != user.0 {
            return (
                StatusCode::FORBIDDEN,
                "media session belongs to another user",
            )
                .into_response();
        }
        (
            session.kind.clone(),
            session.stream_id.clone(),
            Some(session),
        )
    } else {
        let Some(stream_id) = segments.next() else {
            return StatusCode::NOT_FOUND.into_response();
        };
        (route_kind.to_string(), stream_id.to_string(), None)
    };
    if kind != "whip" && kind != "whep" {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Some(grant) = authorize(&state, &kind, &user.0, &stream_id).await else {
        return (StatusCode::FORBIDDEN, "media stream is not authorized").into_response();
    };
    if existing_session
        .as_ref()
        .is_some_and(|session| !same_grant(session, &grant))
    {
        return (StatusCode::FORBIDDEN, "media stream is not authorized").into_response();
    }

    let url = format!(
        "{}{}",
        state.cfg.live777_url.trim_end_matches('/'),
        resource
    );
    let connection = connection_headers(&headers);
    let is_delete = method == Method::DELETE;
    let is_initial = method == Method::POST && existing_session.is_none();
    let mut request = state.http.request(method, &url).body(body);
    for (name, value) in &headers {
        if !stripped(name, &connection, true) {
            request = request.header(name, value);
        }
    }
    if !state.cfg.live777_token.is_empty() {
        request = request.bearer_auth(&state.cfg.live777_token);
    }

    let response = match request.send().await {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!("Live777 request failed: {error}");
            return (StatusCode::BAD_GATEWAY, "upstream request failed").into_response();
        }
    };
    let status =
        StatusCode::from_u16(response.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let upstream_url = response.url().clone();
    let connection = connection_headers(response.headers());
    let mut session_mapping = None;
    let mut builder = Response::builder().status(status);
    for (name, value) in response.headers() {
        if stripped(name, &connection, false) {
            continue;
        }
        if name == header::LOCATION {
            if let Some(location) = rewritten_location(value, &upstream_url) {
                if is_initial && status.is_success() {
                    if let (Some(path), Some(resource)) =
                        (location.session_path, location.session_resource)
                    {
                        session_mapping = Some((
                            path,
                            MediaSession {
                                user_id: user.0.clone(),
                                stream_id: stream_id.clone(),
                                kind: kind.clone(),
                                room_id: grant.room_id.clone(),
                                meeting_no: grant.meeting_no.clone(),
                                resource,
                            },
                        ));
                    }
                }
                builder = builder.header(name, location.value);
            }
        } else {
            builder = builder.header(name, value);
        }
    }
    match response.bytes().await {
        Ok(body) => {
            if route_kind == "session" && status == StatusCode::NOT_FOUND {
                if let Some(expected) = existing_session.as_ref() {
                    let mut sessions = state.media_sessions.lock().await;
                    if sessions.get(uri.path()) == Some(expected) {
                        sessions.remove(uri.path());
                    }
                }
            } else if is_delete && (status.is_success() || status == StatusCode::NOT_FOUND) {
                let mut sessions = state.media_sessions.lock().await;
                if let Some(expected) = existing_session.as_ref() {
                    if sessions.get(uri.path()) == Some(expected) {
                        sessions.remove(uri.path());
                    }
                } else {
                    sessions.retain(|_, session| {
                        session.user_id != user.0
                            || session.stream_id != stream_id
                            || session.kind != kind
                    });
                }
            }
            if let Some((path, session)) = session_mapping {
                match register_media_session(&state, path, session).await {
                    Ok(replaced) => revoke_media_sessions(&state, replaced).await,
                    Err(session) => {
                        revoke_media_sessions(&state, vec![*session]).await;
                        return (
                            StatusCode::FORBIDDEN,
                            "media authorization changed during signaling",
                        )
                            .into_response();
                    }
                }
            }
            builder
                .body(Body::from(body))
                .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
        }
        Err(error) => {
            if let Some((_, session)) = session_mapping {
                revoke_media_sessions(&state, vec![session]).await;
            }
            tracing::warn!("Live777 response body failed: {error}");
            (StatusCode::BAD_GATEWAY, "upstream response body failed").into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connection_and_credentials_are_not_forwarded() {
        let mut headers = HeaderMap::new();
        headers.insert(header::CONNECTION, HeaderValue::from_static("x-remove"));
        headers.insert("x-remove", HeaderValue::from_static("yes"));
        let connection = connection_headers(&headers);
        assert!(stripped(&header::AUTHORIZATION, &connection, true));
        assert!(stripped(
            &HeaderName::from_static("x-remove"),
            &connection,
            true
        ));
        assert!(!stripped(&header::IF_MATCH, &connection, true));
        assert!(!stripped(&header::AUTHORIZATION, &connection, false));
    }

    #[test]
    fn upstream_location_stays_on_the_woom_proxy() {
        let base = reqwest::Url::parse("http://live777:7777/whip/user").unwrap();
        let location = HeaderValue::from_static("http://live777:7777/whip/user/session?x=1");
        let rewritten = rewritten_location(&location, &base).unwrap();
        assert_eq!(
            rewritten.value,
            HeaderValue::from_static("/whip/user/session?x=1")
        );
        assert!(rewritten.session_path.is_none());

        for location in [
            HeaderValue::from_static("/session/abc?x=1"),
            HeaderValue::from_static("http://live777:7777/session/abc?x=1"),
            HeaderValue::from_static("../session/abc?x=1"),
        ] {
            let rewritten = rewritten_location(&location, &base).unwrap();
            assert_eq!(
                rewritten.value,
                HeaderValue::from_static("/session/abc?x=1")
            );
            assert_eq!(rewritten.session_path.as_deref(), Some("/session/abc"));
            assert_eq!(
                rewritten.session_resource.as_deref(),
                Some("/session/abc?x=1")
            );
        }
        assert!(rewritten_location(
            &HeaderValue::from_static("https://example.com/other"),
            &base
        )
        .is_none());
    }
}
