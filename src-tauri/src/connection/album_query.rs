//! Album search policy only; ranking and general file-search syntax are unchanged.
use super::store::{self, DecodeError, JsonFile};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex,
    },
};
use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

pub const MAX_QUERY_BYTES: usize = 200;
const MAX_HISTORY: usize = 1_000;
const COMMON: &[&str] = &[
    "and", "the", "for", "from", "with", "all", "into", "over", "under", "through", "that", "this",
    "your", "you", "our", "are", "was", "were", "have", "has", "vol", "volume",
];

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct AlbumIdentity {
    pub artist: String,
    pub title: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum QueryVariant {
    ArtistTitle,
    TitleOnly,
    Distinctive,
}

#[derive(Clone, Debug)]
pub struct AlbumQueryPlan {
    key: String,
    artist_words: Vec<String>,
    variants: Vec<(QueryVariant, String)>,
    index: usize,
    primary_truncated: bool,
}

impl AlbumQueryPlan {
    pub fn new(identity: &AlbumIdentity, preferred: Option<QueryVariant>) -> Result<Self, String> {
        if identity.artist.len() > 512 || identity.title.len() > 1_024 {
            return Err("Album search metadata is too long.".into());
        }
        let artist_words = words(&identity.artist);
        let title_words = words(strip_editions(&identity.title));
        let artist = query_words(&artist_words);
        let title = query_words(&title_words);
        if capped(title.iter()).is_empty() {
            return Err("The album title has no searchable words.".into());
        }
        let mut distinctive = title
            .iter()
            .filter(|word| !COMMON.contains(&word.as_str()))
            .cloned()
            .collect::<Vec<_>>();
        distinctive.sort_by_key(|word| std::cmp::Reverse(word.chars().count()));
        distinctive.truncate(2);
        let primary_truncated = artist
            .iter()
            .chain(&title)
            .map(|word| word.len() + 1)
            .sum::<usize>()
            .saturating_sub(1)
            > MAX_QUERY_BYTES;
        let primary = if primary_truncated {
            // Never spend the entire byte budget on a long artist name. Retain
            // title words first and verify the omitted artist in returned paths.
            capped(title.iter().chain(&artist))
        } else {
            capped(artist.iter().chain(&title))
        };
        let mut variants = vec![(QueryVariant::ArtistTitle, primary)];
        if !artist_words.is_empty() {
            variants.push((QueryVariant::TitleOnly, capped(title.iter())));
            if !distinctive.is_empty() {
                variants.push((
                    QueryVariant::Distinctive,
                    capped(artist.iter().chain(&distinctive)),
                ));
            }
        }
        let mut seen = HashSet::new();
        variants.retain(|(_, query)| {
            let mut terms = query.split_whitespace().collect::<Vec<_>>();
            terms.sort_unstable();
            !query.is_empty() && seen.insert(terms.join(" "))
        });
        if variants.is_empty() {
            return Err("The album title has no searchable words within the query limit.".into());
        }
        if let Some(index) = variants
            .iter()
            .position(|(kind, _)| Some(*kind) == preferred)
        {
            let previous = variants.remove(index);
            variants.insert(0, previous);
        }
        Ok(Self {
            // Preserve meaningful short words and volume numbers in the cache key.
            key: format!("{}\0{}", artist_words.join(" "), title_words.join(" ")),
            artist_words,
            variants,
            index: 0,
            primary_truncated,
        })
    }

    pub fn query(&self) -> &str {
        &self.variants[self.index].1
    }
    pub fn variant(&self) -> QueryVariant {
        self.variants[self.index].0
    }
    pub fn advance(&mut self) -> bool {
        if self.index + 1 >= self.variants.len() {
            return false;
        }
        self.index += 1;
        true
    }
    pub fn status(&self) -> String {
        format!(
            "Album query {}/{}: {}",
            self.index + 1,
            self.variants.len(),
            self.query()
        )
    }
    pub fn accepts(&self, filename: &str) -> bool {
        if !filename.rsplit('.').next().is_some_and(|extension| {
            [
                "aac", "aiff", "alac", "ape", "flac", "m4a", "mp3", "ogg", "opus", "wav", "wma",
                "wv",
            ]
            .contains(&extension.to_ascii_lowercase().as_str())
        }) {
            return false;
        }
        if self.variant() == QueryVariant::ArtistTitle
            && (!self.primary_truncated || self.artist_words.is_empty())
        {
            return true;
        }
        let path_words = words(filename);
        let significant = self
            .artist_words
            .iter()
            .filter(|word| !matches!(word.as_str(), "and" | "the"))
            .collect::<Vec<_>>();
        !significant.is_empty() && significant.iter().all(|word| path_words.contains(word))
    }
}

pub fn next_token(counter: &AtomicU32) -> u32 {
    loop {
        let token = counter.fetch_add(1, Ordering::SeqCst);
        if token != 0 {
            return token;
        }
    }
}

pub fn words(value: &str) -> Vec<String> {
    let mut normalized = String::new();
    for c in value
        .nfkd()
        .filter(|c| !is_combining_mark(*c))
        .flat_map(char::to_lowercase)
    {
        match c {
            '&' => normalized.push_str(" and "),
            'ø' => normalized.push('o'),
            'ł' => normalized.push('l'),
            'æ' => normalized.push_str("ae"),
            'œ' => normalized.push_str("oe"),
            'ß' => normalized.push_str("ss"),
            c if c.is_alphanumeric() => normalized.push(c),
            _ => normalized.push(' '),
        }
    }
    normalized.split_whitespace().map(str::to_owned).collect()
}

fn query_words(words: &[String]) -> Vec<String> {
    let long = words
        .iter()
        .filter(|word| word.chars().count() > 2 && word.as_str() != "and")
        .cloned()
        .collect::<Vec<_>>();
    // U2, AC/DC, XX and non-Latin titles must not collapse into an empty query.
    if long.is_empty() {
        words
            .iter()
            .filter(|w| w.as_str() != "and")
            .cloned()
            .collect()
    } else {
        long
    }
}

fn capped<'a>(words: impl Iterator<Item = &'a String>) -> String {
    let mut result = String::new();
    let mut seen = HashSet::new();
    for word in words {
        if !seen.insert(word) {
            continue;
        }
        if result.len() + usize::from(!result.is_empty()) + word.len() > MAX_QUERY_BYTES {
            continue;
        }
        if !result.is_empty() {
            result.push(' ');
        }
        result.push_str(word);
    }
    result
}

fn edition(value: &str) -> bool {
    let tokens = words(value);
    tokens.iter().any(|word| {
        matches!(
            word.as_str(),
            "deluxe" | "remaster" | "remastered" | "reissue" | "anniversary" | "expanded"
        )
    }) && tokens.iter().all(|word| {
        matches!(
            word.as_str(),
            "deluxe"
                | "remaster"
                | "remastered"
                | "reissue"
                | "anniversary"
                | "expanded"
                | "edition"
                | "version"
                | "super"
                | "special"
                | "digital"
        ) || word.chars().all(|c| c.is_ascii_digit())
            || word
                .strip_suffix("th")
                .is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
    })
}

fn strip_editions(mut title: &str) -> &str {
    loop {
        title = title.trim();
        let bracket = [('(', ')'), ('[', ']')].iter().find_map(|(open, close)| {
            title
                .strip_suffix(*close)
                .and_then(|body| body.rsplit_once(*open))
                .filter(|(_, suffix)| edition(suffix))
                .map(|(base, _)| base)
        });
        let separated = [" - ", " – ", " — "].iter().find_map(|sep| {
            title
                .rsplit_once(sep)
                .filter(|(_, suffix)| edition(suffix))
                .map(|(base, _)| base)
        });
        match bracket.or(separated) {
            Some(base) if !base.trim().is_empty() => title = base,
            _ => return title,
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
struct SuccessfulQuery {
    key: String,
    variant: QueryVariant,
}
#[derive(Deserialize, Serialize)]
struct QueryStore {
    version: u32,
    entries: Vec<SuccessfulQuery>,
}
impl Default for QueryStore {
    fn default() -> Self {
        Self {
            version: 1,
            entries: Vec::new(),
        }
    }
}

#[derive(Clone, Default)]
pub struct QueryMemory {
    file: Option<JsonFile>,
    store: Arc<Mutex<QueryStore>>,
}
impl QueryMemory {
    pub fn new(file: JsonFile) -> Self {
        let store = file.load(QueryStore::default, |bytes| {
            let store: QueryStore = store::decode(bytes, 1, None, &[])?;
            if store.entries.len() > MAX_HISTORY
                || store.entries.iter().any(|entry| entry.key.len() > 4_096)
            {
                return Err(DecodeError::Invalid(
                    "Album query history exceeds its limits.".into(),
                ));
            }
            Ok(store)
        });
        Self {
            file: Some(file),
            store: Arc::new(Mutex::new(store)),
        }
    }
    pub fn plan(&self, identity: &AlbumIdentity) -> Result<AlbumQueryPlan, String> {
        let mut plan = AlbumQueryPlan::new(identity, None)?;
        if let Some(entry) = self
            .store
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .entries
            .iter()
            .find(|entry| entry.key == plan.key)
        {
            plan = AlbumQueryPlan::new(identity, Some(entry.variant))?;
        }
        Ok(plan)
    }
    pub fn remember(&self, plan: &AlbumQueryPlan) {
        let mut store = self.store.lock().unwrap_or_else(|p| p.into_inner());
        if store
            .entries
            .iter()
            .any(|entry| entry.key == plan.key && entry.variant == plan.variant())
        {
            return;
        }
        store.entries.retain(|entry| entry.key != plan.key);
        if store.entries.len() >= MAX_HISTORY {
            store.entries.remove(0);
        }
        store.entries.push(SuccessfulQuery {
            key: plan.key.clone(),
            variant: plan.variant(),
        });
        if let Some(file) = &self.file {
            if let Err(error) = file.save(&*store) {
                eprintln!("Could not save album query preference: {error}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn identity(artist: &str, title: &str) -> AlbumIdentity {
        AlbumIdentity {
            artist: artist.into(),
            title: title.into(),
        }
    }

    #[test]
    fn normalization_handles_real_titles_editions_and_short_names() {
        for (artist, title, expected) in [
            (
                "Björk",
                "Début (Deluxe Edition) [Remastered 2011]",
                "bjork debut",
            ),
            (
                "Metallica",
                "…And Justice for All",
                "metallica justice for all",
            ),
            (
                "The Beatles",
                "Sgt. Pepper's Lonely Hearts Club Band - 2017 Remaster",
                "the beatles sgt pepper lonely hearts club band",
            ),
            ("Simon & Garfunkel", "Bookends", "simon garfunkel bookends"),
            ("U2", "Rattle and Hum", "u2 rattle hum"),
            ("AC/DC", "Back in Black", "ac dc back black"),
            ("XX", "II", "xx ii"),
            ("坂本龍一", "音楽", "坂本龍一 音楽"),
        ] {
            assert_eq!(
                AlbumQueryPlan::new(&identity(artist, title), None)
                    .unwrap()
                    .query(),
                expected
            );
        }
        assert_eq!(words("Simon & Garfunkel"), words("Simon and Garfunkel"));
        assert_eq!(words("Bjo\u{308}rk"), words("Björk"));
        assert_eq!(
            strip_editions("Turn Blue (Live at the Apollo)"),
            "Turn Blue (Live at the Apollo)"
        );
        assert_eq!(strip_editions("Deluxe"), "Deluxe");
        assert_eq!(strip_editions("Hits Vol. 2"), "Hits Vol. 2");
        assert_eq!(
            strip_editions("The Remastered Sessions"),
            "The Remastered Sessions"
        );
    }

    #[test]
    fn bounded_unique_fallbacks_filter_artist_words_and_non_audio() {
        let mut plan = AlbumQueryPlan::new(
            &identity("Björk", "A Long Walk Through the Northern Lights"),
            None,
        )
        .unwrap();
        assert!(!plan.accepts("Music\\cover.jpg"));
        assert!(plan.advance());
        assert_eq!(plan.variant(), QueryVariant::TitleOnly);
        assert!(!plan.query().contains("bjork"));
        assert!(plan.accepts("Music\\Bjork\\Northern Lights\\01.flac"));
        assert!(!plan.accepts("Music\\Other Artist\\Northern Lights\\01.flac"));
        assert!(!plan.accepts("Music\\Bjorkish\\Northern Lights\\01.flac"));
        assert!(plan.advance());
        assert_eq!(plan.query(), "bjork northern lights");
        assert!(!plan.advance());
        let mut short = AlbumQueryPlan::new(&identity("U2", "War"), None).unwrap();
        assert!(short.advance());
        assert!(short.accepts("U2\\War\\01.mp3"));
        assert!(!short.accepts("U20\\War\\01.mp3"));
        assert!(!short.advance());
        let mut duplicate = AlbumQueryPlan::new(&identity("Artist", "Two Words"), None).unwrap();
        assert!(duplicate.advance());
        assert!(!duplicate.advance());
    }

    #[test]
    fn capped_queries_are_valid_utf8_and_never_empty() {
        let id = identity("Artist", &"éclair ".repeat(80));
        let mut plan = AlbumQueryPlan::new(&id, None).unwrap();
        loop {
            assert!(!plan.query().is_empty());
            assert!(plan.query().len() <= MAX_QUERY_BYTES);
            assert!(plan
                .query()
                .split_whitespace()
                .all(|term| ["artist", "eclair"].contains(&term)));
            if !plan.advance() {
                break;
            }
        }
        assert!(AlbumQueryPlan::new(&identity("Artist", "... [!!!]"), None).is_err());
        assert!(AlbumQueryPlan::new(&identity("Artist", &"x".repeat(201)), None).is_err());
        let long_title = "t".repeat(190);
        let capped = AlbumQueryPlan::new(&identity("Long Artist Name", &long_title), None).unwrap();
        assert!(capped.query().contains(&long_title));
        assert!(!capped.accepts(&format!("Other\\{long_title}\\01.flac")));
        assert!(capped.accepts(&format!("Long Artist Name\\{long_title}\\01.flac")));
        assert!(AlbumQueryPlan::new(&identity("a", &"x".repeat(1_025)), None).is_err());
        let mut legacy =
            AlbumQueryPlan::new(&identity("", "Raw Folder (Deluxe Edition)"), None).unwrap();
        assert_eq!(legacy.query(), "raw folder");
        assert!(!legacy.advance());
    }

    #[test]
    fn successful_variant_is_shared_persisted_and_does_not_merge_volume_numbers() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("search-queries.json");
        let memory = QueryMemory::new(JsonFile::new(path.clone()));
        let id = identity("Björk", "Hits Vol. 2 (Deluxe Edition)");
        let mut plan = memory.plan(&id).unwrap();
        plan.advance();
        memory.remember(&plan);
        assert_eq!(
            memory.clone().plan(&id).unwrap().variant(),
            QueryVariant::TitleOnly
        );
        let restored = QueryMemory::new(JsonFile::new(path));
        assert_eq!(
            restored
                .plan(&identity("Bjork", "Hits Vol. 2"))
                .unwrap()
                .variant(),
            QueryVariant::TitleOnly
        );
        assert_eq!(
            restored
                .plan(&identity("Bjork", "Hits Vol. 1"))
                .unwrap()
                .variant(),
            QueryVariant::ArtistTitle
        );
        let mut retry = restored.plan(&id).unwrap();
        assert!(retry.advance());
        assert_eq!(retry.variant(), QueryVariant::ArtistTitle);
    }

    #[test]
    fn history_is_bounded_and_uses_crash_safe_recovery_and_future_version_protection() {
        let memory = QueryMemory::default();
        for index in 0..MAX_HISTORY + 10 {
            memory.remember(
                &memory
                    .plan(&identity("Artist", &format!("Album {index}")))
                    .unwrap(),
            );
        }
        assert_eq!(memory.store.lock().unwrap().entries.len(), MAX_HISTORY);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("search-queries.json");
        let file = JsonFile::new(path.clone());
        let memory = QueryMemory::new(file.clone());
        let id = identity("Artist", "Album");
        let mut plan = memory.plan(&id).unwrap();
        memory.remember(&plan);
        plan.advance();
        memory.remember(&plan);
        std::fs::write(&path, b"{broken").unwrap();
        let file = JsonFile::new(path.clone());
        assert_eq!(
            QueryMemory::new(file.clone()).plan(&id).unwrap().variant(),
            QueryVariant::ArtistTitle
        );
        assert_eq!(file.notices().len(), 2);
        let future = br#"{"version":99,"keep":"me"}"#;
        std::fs::write(&path, future).unwrap();
        let memory = QueryMemory::new(JsonFile::new(path.clone()));
        memory.remember(&plan);
        assert_eq!(std::fs::read(path).unwrap(), future);
    }
}
