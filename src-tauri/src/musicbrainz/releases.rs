//! Date-bounded radar queries share the client's transport pacing and deadlines.
use super::*;
use time::{Date, Duration, Month, OffsetDateTime};

#[derive(Deserialize)]
struct Response {
    count: usize,
    offset: usize,
    #[serde(rename = "release-groups")]
    groups: Vec<Group>,
}

#[derive(Deserialize)]
struct Group {
    #[serde(flatten)]
    album: AlbumReleaseGroup,
    #[serde(rename = "artist-credit", default)]
    credits: Vec<Credit>,
}

#[derive(Deserialize)]
struct Credit {
    artist: Identity,
}
#[derive(Deserialize)]
struct Identity {
    id: String,
}

pub(crate) fn today() -> Date {
    OffsetDateTime::now_utc().date()
}

// Retain the provider's precision. A partial date overlaps a window; it is not
// silently presented as January 1 / the first day of a month.
pub(crate) fn date_range(value: &str) -> Option<(Date, Date)> {
    if !matches!(value.len(), 4 | 7 | 10) {
        return None;
    }
    let parts: Vec<_> = value.split('-').collect();
    let year: i32 = parts.first()?.parse().ok()?;
    if !(1900..=9998).contains(&year) {
        return None;
    }
    let month = if parts.len() > 1 {
        Month::try_from(parts[1].parse::<u8>().ok()?).ok()?
    } else {
        Month::January
    };
    let day = if parts.len() > 2 {
        parts[2].parse().ok()?
    } else {
        1
    };
    let start = Date::from_calendar_date(year, month, day).ok()?;
    let end = match parts.len() {
        1 => Date::from_calendar_date(year, Month::December, 31).ok()?,
        2 => if month == Month::December {
            Date::from_calendar_date(year + 1, Month::January, 1).ok()?
        } else {
            Date::from_calendar_date(year, month.next(), 1).ok()?
        }
        .previous_day()?,
        3 => start,
        _ => return None,
    };
    Some((start, end))
}

pub(crate) fn in_window(album: &AlbumReleaseGroup, date: Date) -> bool {
    is_musicbrainz_id(&album.id)
        && !album.title.trim().is_empty()
        && album.title.chars().count() <= 500
        && !album.title.chars().any(char::is_control)
        && matches!(
            album.primary_type.as_deref(),
            Some("Album" | "EP" | "Single")
        )
        && date_range(&album.first_release_date).is_some_and(|(start, end)| {
            end >= date - Duration::days(90) && start <= date + Duration::days(90)
        })
}

impl MusicBrainzClient {
    pub async fn recent_releases(&self, artist_id: &str) -> Result<AlbumCatalog, String> {
        let id = artist_id.to_ascii_lowercase();
        if !is_musicbrainz_id(&id) {
            return Err("Choose a valid MusicBrainz artist.".into());
        }
        let date = today();
        let deadline = Instant::now() + LOOKUP_TIMEOUT;
        let _lookup = self.lookup_slot(deadline).await?;
        let query = format!("arid:{id} AND status:official AND (primarytype:album OR primarytype:ep OR primarytype:single) AND firstreleasedate:[{} TO {}]", date - Duration::days(90), date + Duration::days(90));
        let mut albums = Vec::new();
        let mut offset = 0;
        let mut total = 0;
        for _ in 0..3 {
            let response: Response = self
                .transport
                .get(
                    "/release-group",
                    &[
                        ("query", query.clone()),
                        ("fmt", "json".into()),
                        ("limit", "100".into()),
                        ("offset", offset.to_string()),
                    ],
                    deadline,
                )
                .await
                .map_err(|e| e.to_string())?;
            total = response.count;
            let next = response.offset.saturating_add(response.groups.len());
            let stalled = response.groups.is_empty() || next <= offset;
            for group in response.groups {
                if group
                    .credits
                    .iter()
                    .any(|credit| credit.artist.id.eq_ignore_ascii_case(&id))
                    && in_window(&group.album, date)
                {
                    let mut album = group.album;
                    album.id.make_ascii_lowercase();
                    album.cover_art_url = format!(
                        "https://coverartarchive.org/release-group/{}/front-250",
                        album.id
                    );
                    albums.push(album);
                }
            }
            offset = next;
            if stalled || offset >= total {
                break;
            }
        }
        albums.sort_by(|a, b| {
            b.first_release_date
                .cmp(&a.first_release_date)
                .then(a.id.cmp(&b.id))
        });
        let mut seen = std::collections::HashSet::new();
        albums.retain(|a| seen.insert(a.id.clone()));
        Ok(AlbumCatalog {
            artist_id: id,
            albums,
            truncated: offset < total,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_partial_dates_and_rejects_invalid_dates() {
        assert_eq!(date_range("2024-02").unwrap().1.day(), 29);
        assert_eq!(date_range("2026").unwrap().1.to_string(), "2026-12-31");
        for date in [
            "",
            "2026-13",
            "2026-02-29",
            "2026-1",
            "2026-01-00",
            "tomorrow",
        ] {
            assert!(date_range(date).is_none());
        }
    }
    #[test]
    fn filters_old_reissues_and_keeps_upcoming_partial_dates() {
        let mut album = AlbumReleaseGroup {
            id: "0383dadf-2a4e-4d10-a46a-e9e041da8eb3".into(),
            title: "New record".into(),
            first_release_date: "1980-01-01".into(),
            primary_type: Some("Album".into()),
            secondary_types: vec![],
            cover_art_url: String::new(),
        };
        let date = Date::from_calendar_date(2026, Month::October, 24).unwrap();
        assert!(!in_window(&album, date));
        album.first_release_date = "2026-11".into();
        assert!(in_window(&album, date));
        album.first_release_date = "2028".into();
        assert!(!in_window(&album, date));
    }
}
