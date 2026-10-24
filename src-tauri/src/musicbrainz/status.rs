use serde::Serialize;
use std::sync::{Arc, Mutex};

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientStatus {
    pub revision: u64,
    pub retry_at_ms: Option<u64>,
    pub cache_warning: Option<String>,
}

#[derive(Clone, Default)]
pub(super) struct StatusHub {
    state: Arc<Mutex<ClientStatus>>,
    publish: Option<Arc<dyn Fn(ClientStatus) + Send + Sync>>,
}

impl StatusHub {
    pub fn new(publish: impl Fn(ClientStatus) + Send + Sync + 'static) -> Self {
        Self {
            publish: Some(Arc::new(publish)),
            ..Self::default()
        }
    }

    pub fn snapshot(&self) -> ClientStatus {
        self.state.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    fn update(&self, change: impl FnOnce(&mut ClientStatus)) {
        let next = {
            let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            change(&mut state);
            state.revision += 1;
            state.clone()
        };
        if let Some(publish) = &self.publish {
            publish(next);
        }
    }

    pub fn cooldown(&self, retry_at_ms: u64) {
        self.update(|s| s.retry_at_ms = Some(retry_at_ms));
    }

    pub fn cache_warning(&self, message: String) {
        self.update(|s| s.cache_warning = Some(message));
    }
}
