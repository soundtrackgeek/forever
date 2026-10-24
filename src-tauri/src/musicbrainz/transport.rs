use super::{
    cache::{now_ms, MAX_ENTRY_BYTES},
    status::StatusHub,
};
use serde::de::DeserializeOwned;
use std::time::{Duration, SystemTime};
use tokio::{
    sync::Mutex,
    time::{sleep_until, timeout_at, Instant},
};

pub(super) const USER_AGENT: &str = concat!(
    "Forever/",
    env!("CARGO_PKG_VERSION"),
    " (https://github.com/soundtrackgeek/forever)"
);
const REQUEST_INTERVAL: Duration = Duration::from_millis(1050);
pub(super) const LOOKUP_TIMEOUT: Duration = Duration::from_secs(45);
const MAX_ATTEMPTS: u32 = 3;

#[derive(Debug, thiserror::Error)]
pub(super) enum RequestError {
    #[error("MusicBrainz took too long to answer. Try again in a moment.")]
    Timeout,
    #[error("MusicBrainz is busy or rate-limiting. Try again in {0} s.")]
    Throttled(u64),
    #[error("MusicBrainz returned HTTP {0}. Try again later.")]
    Http(reqwest::StatusCode),
    #[error("Forever could not reach MusicBrainz: {0}")]
    Network(String),
    #[error("MusicBrainz returned an invalid or oversized response: {0}")]
    Invalid(String),
}

pub(super) struct Transport {
    client: Result<reqwest::Client, String>,
    base_url: String,
    next_request: Mutex<Instant>,
    status: StatusHub,
}

impl Transport {
    #[cfg(test)]
    pub fn is_ready(&self) -> bool {
        self.client.is_ok()
    }

    #[cfg(test)]
    pub fn set_base_url(&mut self, url: String) {
        self.base_url = url;
    }
    pub fn new(status: StatusHub) -> Self {
        let _ = rustls::crypto::ring::default_provider().install_default();
        Self {
            client: reqwest::Client::builder()
                .user_agent(USER_AGENT)
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(15))
                // Redirects and hidden HTTP retries must not bypass the shared governor.
                .redirect(reqwest::redirect::Policy::none())
                .retry(reqwest::retry::never())
                .build()
                .map_err(|e| e.to_string()),
            base_url: "https://musicbrainz.org/ws/2".into(),
            next_request: Mutex::new(Instant::now()),
            status,
        }
    }

    pub async fn get<T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, String)],
        deadline: Instant,
    ) -> Result<T, RequestError> {
        let client = self
            .client
            .as_ref()
            .map_err(|e| RequestError::Network(e.clone()))?;
        for attempt in 0..MAX_ATTEMPTS {
            // Keep the gate through the response, so a 503 cooldown is established
            // before any other producer can send. Cancellation retains next_request.
            let mut next = timeout_at(deadline, self.next_request.lock())
                .await
                .map_err(|_| RequestError::Timeout)?;
            if *next >= deadline {
                return Err(RequestError::Throttled(seconds_left(*next)));
            }
            sleep_until(*next).await;
            *next = Instant::now() + REQUEST_INTERVAL;
            let mut response = timeout_at(
                deadline,
                client
                    .get(format!("{}{path}", self.base_url))
                    .query(query)
                    .send(),
            )
            .await
            .map_err(|_| RequestError::Timeout)?
            .map_err(network_error)?;
            let status = response.status();
            if matches!(status.as_u16(), 429 | 503) {
                let backoff = Duration::from_secs(2u64.pow(attempt + 1));
                let delay = retry_after(
                    response
                        .headers()
                        .get(reqwest::header::RETRY_AFTER)
                        .and_then(|v| v.to_str().ok()),
                    SystemTime::now(),
                )
                .unwrap_or_default()
                .max(backoff);
                *next = (*next).max(Instant::now() + delay);
                self.status.cooldown(
                    now_ms().saturating_add(delay.as_millis().min(u64::MAX as u128) as u64),
                );
                if attempt + 1 == MAX_ATTEMPTS || *next >= deadline {
                    return Err(RequestError::Throttled(seconds_left(*next)));
                }
                continue;
            }
            if !status.is_success() {
                return Err(RequestError::Http(status));
            }
            if response
                .content_length()
                .is_some_and(|n| n > MAX_ENTRY_BYTES as u64)
            {
                return Err(RequestError::Invalid("body exceeds 4 MiB".into()));
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = timeout_at(deadline, response.chunk())
                .await
                .map_err(|_| RequestError::Timeout)?
                .map_err(network_error)?
            {
                if bytes.len() + chunk.len() > MAX_ENTRY_BYTES {
                    return Err(RequestError::Invalid("body exceeds 4 MiB".into()));
                }
                bytes.extend_from_slice(&chunk);
            }
            return serde_json::from_slice(&bytes)
                .map_err(|e| RequestError::Invalid(e.to_string()));
        }
        unreachable!()
    }
}

fn network_error(error: reqwest::Error) -> RequestError {
    if error.is_timeout() {
        RequestError::Timeout
    } else {
        RequestError::Network(error.without_url().to_string())
    }
}

fn seconds_left(until: Instant) -> u64 {
    until
        .saturating_duration_since(Instant::now())
        .as_millis()
        .div_ceil(1000) as u64
}

fn retry_after(value: Option<&str>, now: SystemTime) -> Option<Duration> {
    let value = value?.trim();
    let delay = if let Ok(seconds) = value.parse::<u64>() {
        Duration::from_secs(seconds)
    } else {
        httpdate::parse_http_date(value)
            .ok()?
            .duration_since(now)
            .unwrap_or_default()
    };
    // Reject unrepresentable deadlines rather than panic on hostile headers.
    Instant::now().checked_add(delay).map(|_| delay)
}

#[cfg(test)]
mod tests;
