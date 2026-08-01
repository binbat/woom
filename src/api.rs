use std::collections::HashMap;

use axum::{
    extract::{Path, Request, State},
    http::{header, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{any, get, patch, post},
    Json, Router,
};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use redis::{aio::ConnectionManager, AsyncCommands};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tower_http::trace::TraceLayer;

use crate::{
    config::Config,
    helper,
    model::{Room, RoomAdmin, Stream, ADMIN_UNIQUE_KEY},
    proxy, spa,
};

#[derive(Clone)]
pub struct AppState {
    pub rdb: ConnectionManager,
    pub cfg: Config,
    pub http: reqwest::Client,
}

pub fn router(rdb: ConnectionManager, cfg: Config) -> Router {
    let state = AppState {
        rdb,
        cfg,
        http: reqwest::Client::new(),
    };

    let protected = Router::new()
        .route("/room/", post(create_room))
        .route("/room/{roomId}", get(show_room))
        .route("/room/{roomId}/stream", post(create_room_stream))
        .route(
            "/room/{roomId}/stream/{streamId}",
            patch(update_room_stream).delete(destroy_room_stream),
        )
        .route_layer(middleware::from_fn_with_state(state.clone(), jwt_auth));

    Router::new()
        .merge(protected)
        .route("/user/", post(create_user))
        .route("/whip/{uuid}", any(proxy::forward))
        .route("/whep/{uuid}", any(proxy::forward))
        .fallback(spa::handler)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

#[derive(Serialize, Deserialize)]
struct Claims {
    id: String,
    exp: usize,
    iat: usize,
    nbf: usize,
}

fn token_from_header(headers: &HeaderMap) -> &str {
    let bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if bearer.len() > 7 && bearer[..6].eq_ignore_ascii_case("bearer") {
        &bearer[7..]
    } else {
        ""
    }
}

async fn jwt_auth(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let token = token_from_header(req.headers());
    let result = decode::<Claims>(
        token,
        &DecodingKey::from_secret(state.cfg.secret.as_bytes()),
        &Validation::new(Algorithm::HS512),
    );
    match result {
        Ok(_) => next.run(req).await,
        Err(e) => (StatusCode::UNAUTHORIZED, e.to_string()).into_response(),
    }
}

fn internal_error(e: impl std::fmt::Display) -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
}

async fn create_user(State(state): State<AppState>) -> Response {
    let stream_id = uuid::Uuid::new_v4().to_string();
    let now = jsonwebtoken::get_current_timestamp();
    let claims = Claims {
        id: stream_id.clone(),
        exp: (now + 10 * 365 * 24 * 3600) as usize,
        iat: now as usize,
        nbf: now as usize,
    };
    match encode(
        &Header::new(Algorithm::HS512),
        &claims,
        &EncodingKey::from_secret(state.cfg.secret.as_bytes()),
    ) {
        Ok(token) => Json(json!({ "streamId": stream_id, "token": token })).into_response(),
        Err(e) => internal_error(e),
    }
}

async fn create_room(State(mut state): State<AppState>) -> Response {
    let room_id = helper::add_split_symbol(&helper::gen_number_secret(9));
    let stream_id = uuid::Uuid::new_v4().to_string();
    let admin = RoomAdmin {
        owner: stream_id.clone(),
        ..Default::default()
    };

    let value = match serde_json::to_string(&admin) {
        Ok(v) => v,
        Err(e) => return internal_error(e),
    };
    if let Err(e) = state
        .rdb
        .hset::<_, _, _, ()>(&room_id, ADMIN_UNIQUE_KEY, value)
        .await
    {
        return internal_error(e);
    }

    Json(Room {
        room_id,
        admin,
        stream_id,
        ..Default::default()
    })
    .into_response()
}

async fn show_room(State(state): State<AppState>, Path(room_id): Path<String>) -> Response {
    match helper_show_room(state, &room_id).await {
        Ok(room) => Json(room).into_response(),
        Err(e) => internal_error(e),
    }
}

async fn create_room_stream(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
) -> Response {
    let mut room = match helper_show_room(state.clone(), &room_id).await {
        Ok(room) => room,
        Err(e) => return internal_error(e),
    };

    let stream_id = uuid::Uuid::new_v4().to_string();
    if let Err(e) = helper_set_room_stream(state, &room_id, &stream_id, &Stream::default()).await {
        return internal_error(e);
    }
    room.stream_id = stream_id;
    Json(room).into_response()
}

async fn update_room_stream(
    State(state): State<AppState>,
    Path((room_id, stream_id)): Path<(String, String)>,
    Json(stream): Json<Stream>,
) -> Response {
    let mut room = match helper_show_room(state.clone(), &room_id).await {
        Ok(room) => room,
        Err(e) => return internal_error(e),
    };

    if let Err(e) = helper_set_room_stream(state, &room_id, &stream_id, &stream).await {
        return internal_error(e);
    }
    room.stream_id = stream_id;
    Json(room).into_response()
}

async fn destroy_room_stream(
    State(mut state): State<AppState>,
    Path((room_id, stream_id)): Path<(String, String)>,
) -> Response {
    if let Err(e) = state.rdb.hdel::<_, _, ()>(&room_id, &stream_id).await {
        return internal_error(e);
    }
    StatusCode::NO_CONTENT.into_response()
}

async fn helper_show_room(
    mut state: AppState,
    room_id: &str,
) -> redis::RedisResult<Room> {
    let result: HashMap<String, String> = state.rdb.hgetall(room_id).await?;

    let mut room = Room {
        room_id: room_id.to_string(),
        ..Default::default()
    };
    for (k, v) in result {
        if k == ADMIN_UNIQUE_KEY {
            if let Ok(admin) = serde_json::from_str(&v) {
                room.admin = admin;
            }
        } else if let Ok(stream) = serde_json::from_str::<Stream>(&v) {
            room.streams.insert(k, stream);
        }
    }
    Ok(room)
}

async fn helper_set_room_stream(
    mut state: AppState,
    room_id: &str,
    stream_id: &str,
    stream: &Stream,
) -> redis::RedisResult<()> {
    let value = serde_json::to_string(stream).map_err(|e| {
        redis::RedisError::from((redis::ErrorKind::TypeError, "json encode failed", e.to_string()))
    })?;
    state.rdb.hset(room_id, stream_id, value).await
}
