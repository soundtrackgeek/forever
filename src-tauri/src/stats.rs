//! Compact local usage aggregates for the Listening Post statistics panel.
//!
//! Hooks call `record` from inside hub locks, so recording only enqueues; one
//! writer thread owns the SQLite connection. Nothing here may affect transfers:
//! every failure is swallowed and the statistics are simply incomplete.
use chrono::{Duration, Local, NaiveDate};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::{mpsc, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

const SCHEMA_VERSION: u32 = 2;
const KEEP_DAYS: i64 = 400;
const KEEP_SOURCES: i64 = 500;
const CHART_DAYS: u32 = 30;
const TOP_SOURCES: usize = 8;

static RECORDER: OnceLock<mpsc::Sender<(String, Event)>> = OnceLock::new();
static DATABASE: OnceLock<PathBuf> = OnceLock::new();

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    Passed,
    Review,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Event {
    Download {
        username: String,
        bytes: u64,
        /// Measured bytes per second for this file; 0 when unknown.
        speed: u64,
    },
    DownloadFailed {
        username: String,
    },
    Upload {
        bytes: u64,
    },
    WantedAdded(u32),
    WantedCheck {
        hit: bool,
    },
    WantedFulfilled {
        found_after_ms: u64,
    },
    Soundcheck(Outcome),
    Reachability {
        reachable: bool,
    },
}

pub fn record(event: Event) {
    if let Some(sender) = RECORDER.get() {
        let _ = sender.send((today(), event));
    }
}

fn today() -> String {
    Local::now().date_naive().format("%Y-%m-%d").to_string()
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

fn clamp(value: u64) -> i64 {
    value.min(i64::MAX as u64) as i64
}

pub fn start(path: PathBuf) {
    let (sender, receiver) = mpsc::channel();
    if RECORDER.set(sender).is_err() {
        return;
    }
    let _ = DATABASE.set(path.clone());
    let _ = std::thread::Builder::new()
        .name("forever-stats".into())
        .spawn(move || {
            let Some(connection) = open(&path).ok() else {
                return;
            };
            for (day, event) in receiver {
                let _ = apply(&connection, &day, &event);
            }
        });
}

fn open(path: &Path) -> rusqlite::Result<Connection> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let connection = Connection::open(path)?;
    prepare(&connection)?;
    Ok(connection)
}

fn prepare(connection: &Connection) -> rusqlite::Result<()> {
    connection.busy_timeout(std::time::Duration::from_millis(250))?;
    let version: u32 = connection.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version > SCHEMA_VERSION {
        // Never modify a database written by a newer build.
        return Err(rusqlite::Error::InvalidQuery);
    }
    connection.execute_batch(&format!(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
        CREATE TABLE IF NOT EXISTS daily (
            day TEXT PRIMARY KEY,
            {}
        );
        CREATE TABLE IF NOT EXISTS sources (
            username TEXT PRIMARY KEY, files INTEGER NOT NULL DEFAULT 0,
            bytes INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0,
            last_ms INTEGER NOT NULL DEFAULT 0,
            speed_total INTEGER NOT NULL DEFAULT 0,
            speed_samples INTEGER NOT NULL DEFAULT 0);
        PRAGMA user_version={SCHEMA_VERSION};",
        COLUMNS
            .iter()
            .map(|c| format!("{c} INTEGER NOT NULL DEFAULT 0"))
            .collect::<Vec<_>>()
            .join(",\n")
    ))?;
    // Version 1 databases predate the speed columns; CREATE TABLE IF NOT EXISTS
    // leaves them untouched, so add what is missing.
    for column in ["speed_total", "speed_samples"] {
        let present: i64 = connection.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('sources') WHERE name = ?1",
            params![column],
            |r| r.get(0),
        )?;
        if present == 0 {
            connection.execute(
                &format!("ALTER TABLE sources ADD COLUMN {column} INTEGER NOT NULL DEFAULT 0"),
                [],
            )?;
        }
    }
    let cutoff = (Local::now().date_naive() - Duration::days(KEEP_DAYS))
        .format("%Y-%m-%d")
        .to_string();
    connection.execute("DELETE FROM daily WHERE day < ?1", params![cutoff])?;
    connection.execute(
        "DELETE FROM sources WHERE username NOT IN
         (SELECT username FROM sources ORDER BY last_ms DESC LIMIT ?1)",
        params![KEEP_SOURCES],
    )?;
    Ok(())
}

const COLUMNS: [&str; 15] = [
    "down_bytes",
    "down_files",
    "up_bytes",
    "up_files",
    "down_failures",
    "wanted_added",
    "wanted_checks",
    "wanted_hits",
    "wanted_fulfilled",
    "found_after_ms_total",
    "soundcheck_passed",
    "soundcheck_review",
    "soundcheck_failed",
    "reachable_checks",
    "blocked_checks",
];

fn bump(connection: &Connection, day: &str, deltas: &[(&str, i64)]) -> rusqlite::Result<()> {
    // Column names are compile-time constants; only values are bound.
    let names = deltas.iter().map(|(c, _)| *c).collect::<Vec<_>>().join(",");
    let marks = (0..deltas.len())
        .map(|i| format!("?{}", i + 2))
        .collect::<Vec<_>>()
        .join(",");
    let updates = deltas
        .iter()
        .map(|(c, _)| format!("{c}={c}+excluded.{c}"))
        .collect::<Vec<_>>()
        .join(",");
    let mut values: Vec<&dyn rusqlite::ToSql> = vec![&day];
    values.extend(deltas.iter().map(|(_, v)| v as &dyn rusqlite::ToSql));
    connection.execute(
        &format!(
            "INSERT INTO daily(day,{names}) VALUES(?1,{marks})
             ON CONFLICT(day) DO UPDATE SET {updates}"
        ),
        values.as_slice(),
    )?;
    Ok(())
}

fn bump_source(
    connection: &Connection,
    username: &str,
    files: i64,
    bytes: i64,
    failures: i64,
    speed: i64,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO sources(username,files,bytes,failures,last_ms,speed_total,speed_samples)
         VALUES(?1,?2,?3,?4,?5,?6,?7)
         ON CONFLICT(username) DO UPDATE SET files=files+excluded.files,
         bytes=bytes+excluded.bytes, failures=failures+excluded.failures,
         last_ms=excluded.last_ms, speed_total=speed_total+excluded.speed_total,
         speed_samples=speed_samples+excluded.speed_samples",
        params![
            username.to_ascii_lowercase(),
            files,
            bytes,
            failures,
            now_ms(),
            speed,
            i64::from(speed > 0)
        ],
    )?;
    Ok(())
}

fn apply(connection: &Connection, day: &str, event: &Event) -> rusqlite::Result<()> {
    match event {
        Event::Download {
            username,
            bytes,
            speed,
        } => {
            bump(
                connection,
                day,
                &[("down_bytes", clamp(*bytes)), ("down_files", 1)],
            )?;
            bump_source(connection, username, 1, clamp(*bytes), 0, clamp(*speed))
        }
        Event::DownloadFailed { username } => {
            bump(connection, day, &[("down_failures", 1)])?;
            bump_source(connection, username, 0, 0, 1, 0)
        }
        Event::Upload { bytes } => bump(
            connection,
            day,
            &[("up_bytes", clamp(*bytes)), ("up_files", 1)],
        ),
        Event::WantedAdded(count) => bump(connection, day, &[("wanted_added", i64::from(*count))]),
        Event::WantedCheck { hit } => bump(
            connection,
            day,
            &[("wanted_checks", 1), ("wanted_hits", i64::from(*hit))],
        ),
        Event::WantedFulfilled { found_after_ms } => bump(
            connection,
            day,
            &[
                ("wanted_fulfilled", 1),
                ("found_after_ms_total", clamp(*found_after_ms)),
            ],
        ),
        Event::Soundcheck(outcome) => bump(
            connection,
            day,
            &[(
                match outcome {
                    Outcome::Passed => "soundcheck_passed",
                    Outcome::Review => "soundcheck_review",
                    Outcome::Failed => "soundcheck_failed",
                },
                1,
            )],
        ),
        Event::Reachability { reachable } => bump(
            connection,
            day,
            &[if *reachable {
                ("reachable_checks", 1)
            } else {
                ("blocked_checks", 1)
            }],
        ),
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Counts {
    pub down_bytes: u64,
    pub down_files: u64,
    pub up_bytes: u64,
    pub up_files: u64,
    pub down_failures: u64,
    pub wanted_added: u64,
    pub wanted_checks: u64,
    pub wanted_hits: u64,
    pub wanted_fulfilled: u64,
    pub found_after_ms_total: u64,
    pub soundcheck_passed: u64,
    pub soundcheck_review: u64,
    pub soundcheck_failed: u64,
    pub reachable_checks: u64,
    pub blocked_checks: u64,
}

impl Counts {
    fn from_row(row: &rusqlite::Row<'_>, offset: usize) -> rusqlite::Result<Self> {
        let get = |i: usize| {
            row.get::<_, Option<i64>>(offset + i)
                .map(|v| v.unwrap_or(0).max(0) as u64)
        };
        Ok(Self {
            down_bytes: get(0)?,
            down_files: get(1)?,
            up_bytes: get(2)?,
            up_files: get(3)?,
            down_failures: get(4)?,
            wanted_added: get(5)?,
            wanted_checks: get(6)?,
            wanted_hits: get(7)?,
            wanted_fulfilled: get(8)?,
            found_after_ms_total: get(9)?,
            soundcheck_passed: get(10)?,
            soundcheck_review: get(11)?,
            soundcheck_failed: get(12)?,
            reachable_checks: get(13)?,
            blocked_checks: get(14)?,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayStats {
    pub day: String,
    #[serde(flatten)]
    pub counts: Counts,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceStats {
    pub username: String,
    pub files: u64,
    pub bytes: u64,
    pub failures: u64,
    /// Completed files over completed plus failed attempts.
    pub reliability: Option<f64>,
    /// Average measured download speed in bytes per second, when known.
    pub speed_bytes_per_second: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsSnapshot {
    pub tracked_since: Option<String>,
    pub totals: Counts,
    /// One entry per local calendar day, oldest first, zero-filled.
    pub daily: Vec<DayStats>,
    pub top_sources: Vec<SourceStats>,
}

impl StatsSnapshot {
    fn empty(today: NaiveDate) -> Self {
        Self {
            tracked_since: None,
            totals: Counts::default(),
            daily: days(today, &[]),
            top_sources: Vec::new(),
        }
    }
}

fn days(today: NaiveDate, recorded: &[DayStats]) -> Vec<DayStats> {
    (0..CHART_DAYS)
        .rev()
        .map(|back| {
            let day = (today - Duration::days(i64::from(back)))
                .format("%Y-%m-%d")
                .to_string();
            recorded
                .iter()
                .find(|d| d.day == day)
                .cloned()
                .unwrap_or(DayStats {
                    day,
                    counts: Counts::default(),
                })
        })
        .collect()
}

fn read(connection: &Connection, today: NaiveDate) -> rusqlite::Result<StatsSnapshot> {
    let select = COLUMNS.join(",");
    let sums = COLUMNS
        .iter()
        .map(|c| format!("SUM({c})"))
        .collect::<Vec<_>>()
        .join(",");
    let (tracked_since, totals) =
        connection.query_row(&format!("SELECT MIN(day),{sums} FROM daily"), [], |row| {
            Ok((row.get::<_, Option<String>>(0)?, Counts::from_row(row, 1)?))
        })?;
    let first = (today - Duration::days(i64::from(CHART_DAYS) - 1))
        .format("%Y-%m-%d")
        .to_string();
    let recorded = connection
        .prepare(&format!(
            "SELECT day,{select} FROM daily WHERE day >= ?1 ORDER BY day"
        ))?
        .query_map(params![first], |row| {
            Ok(DayStats {
                day: row.get(0)?,
                counts: Counts::from_row(row, 1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let top_sources = connection
        .prepare(
            "SELECT username,files,bytes,failures,speed_total,speed_samples FROM sources
             WHERE files > 0 ORDER BY bytes DESC, files DESC LIMIT ?1",
        )?
        .query_map(params![TOP_SOURCES as i64], |row| {
            let files = row.get::<_, i64>(1)?.max(0) as u64;
            let failures = row.get::<_, i64>(3)?.max(0) as u64;
            let speed_total = row.get::<_, i64>(4)?.max(0) as u64;
            let speed_samples = row.get::<_, i64>(5)?.max(0) as u64;
            Ok(SourceStats {
                username: row.get(0)?,
                files,
                bytes: row.get::<_, i64>(2)?.max(0) as u64,
                failures,
                reliability: (files + failures > 0)
                    .then(|| files as f64 / (files + failures) as f64),
                speed_bytes_per_second: (speed_samples > 0).then(|| speed_total / speed_samples),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(StatsSnapshot {
        tracked_since,
        totals,
        daily: days(today, &recorded),
        top_sources,
    })
}

fn snapshot_at(path: &Path) -> StatsSnapshot {
    let today = Local::now().date_naive();
    if !path.exists() {
        return StatsSnapshot::empty(today);
    }
    open(path)
        .and_then(|connection| read(&connection, today))
        .unwrap_or_else(|_| StatsSnapshot::empty(today))
}

#[tauri::command]
pub async fn stats_snapshot() -> Result<StatsSnapshot, String> {
    let Some(path) = DATABASE.get().cloned() else {
        return Ok(StatsSnapshot::empty(Local::now().date_naive()));
    };
    tauri::async_runtime::spawn_blocking(move || snapshot_at(&path))
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        prepare(&connection).unwrap();
        connection
    }

    #[test]
    fn events_aggregate_per_day_and_source() {
        let connection = memory();
        let today = Local::now().date_naive();
        let day = today.format("%Y-%m-%d").to_string();
        let yesterday = (today - Duration::days(1)).format("%Y-%m-%d").to_string();
        let events = [
            (
                &day,
                Event::Download {
                    username: "Ada".into(),
                    bytes: 600,
                    speed: 300,
                },
            ),
            (
                &day,
                Event::Download {
                    username: "ada".into(),
                    bytes: 400,
                    speed: 100,
                },
            ),
            (
                &yesterday,
                Event::DownloadFailed {
                    username: "ADA".into(),
                },
            ),
            (
                &day,
                Event::Download {
                    username: "bob".into(),
                    bytes: 5,
                    speed: 0,
                },
            ),
            (&day, Event::Upload { bytes: 250 }),
            (&day, Event::WantedAdded(2)),
            (&day, Event::WantedCheck { hit: true }),
            (&day, Event::WantedCheck { hit: false }),
            (
                &day,
                Event::WantedFulfilled {
                    found_after_ms: 9_000,
                },
            ),
            (&day, Event::Soundcheck(Outcome::Passed)),
            (&day, Event::Soundcheck(Outcome::Failed)),
            (&day, Event::Reachability { reachable: true }),
            (&day, Event::Reachability { reachable: false }),
        ];
        for (when, event) in &events {
            apply(&connection, when, event).unwrap();
        }
        let snapshot = read(&connection, today).unwrap();
        assert_eq!(snapshot.tracked_since.as_deref(), Some(yesterday.as_str()));
        assert_eq!(snapshot.totals.down_bytes, 1_005);
        assert_eq!(snapshot.totals.down_files, 3);
        assert_eq!(snapshot.totals.up_bytes, 250);
        assert_eq!(snapshot.totals.down_failures, 1);
        assert_eq!(snapshot.totals.wanted_added, 2);
        assert_eq!(
            (snapshot.totals.wanted_checks, snapshot.totals.wanted_hits),
            (2, 1)
        );
        assert_eq!(snapshot.totals.found_after_ms_total, 9_000);
        assert_eq!(
            (
                snapshot.totals.soundcheck_passed,
                snapshot.totals.soundcheck_failed
            ),
            (1, 1)
        );
        assert_eq!(
            (
                snapshot.totals.reachable_checks,
                snapshot.totals.blocked_checks
            ),
            (1, 1)
        );
        assert_eq!(snapshot.daily.len(), CHART_DAYS as usize);
        assert_eq!(snapshot.daily.last().unwrap().day, day);
        assert_eq!(snapshot.daily.last().unwrap().counts.down_files, 3);
        assert_eq!(
            snapshot.daily[CHART_DAYS as usize - 2].counts.down_failures,
            1
        );
        assert_eq!(snapshot.daily[0].counts, Counts::default());
        let top = &snapshot.top_sources;
        assert_eq!(top[0].username, "ada");
        assert_eq!((top[0].files, top[0].bytes, top[0].failures), (2, 1_000, 1));
        assert!((top[0].reliability.unwrap() - 2.0 / 3.0).abs() < 1e-9);
        assert_eq!(top[0].speed_bytes_per_second, Some(200));
        assert_eq!(top[1].speed_bytes_per_second, None);
    }

    #[test]
    fn empty_database_is_zero_filled() {
        let connection = memory();
        let snapshot = read(&connection, Local::now().date_naive()).unwrap();
        assert_eq!(snapshot.tracked_since, None);
        assert_eq!(snapshot.totals, Counts::default());
        assert_eq!(snapshot.daily.len(), CHART_DAYS as usize);
        assert!(snapshot.top_sources.is_empty());
    }

    #[test]
    fn version_one_database_gains_speed_columns() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE sources (username TEXT PRIMARY KEY, files INTEGER NOT NULL DEFAULT 0,
                 bytes INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0,
                 last_ms INTEGER NOT NULL DEFAULT 0);
                 INSERT INTO sources VALUES('old', 2, 10, 0, 1);
                 PRAGMA user_version=1;",
            )
            .unwrap();
        prepare(&connection).unwrap();
        let snapshot = read(&connection, Local::now().date_naive()).unwrap();
        assert_eq!(snapshot.top_sources[0].username, "old");
        assert_eq!(snapshot.top_sources[0].speed_bytes_per_second, None);
    }

    #[test]
    fn newer_schema_is_left_untouched() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "user_version", SCHEMA_VERSION + 1)
            .unwrap();
        assert!(prepare(&connection).is_err());
    }
}
