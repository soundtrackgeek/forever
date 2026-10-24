# Tagging and filing

Available in **0.0.74**, under **Archive → Arrivals → File into library**.
The nearby **Filing settings & history** action works even when the arrival list
is empty. This is an explicit file operation; ordinary completion, verification,
and reconciliation do not move or retag music.

## Review and apply

1. Choose an existing library root. Optionally save a separate incomplete folder
   for newly queued downloads. Already queued files keep their paths and resume
   data. Completed downloads stay in that folder until explicitly filed.
2. Choose a naming template. Supported tokens are `{albumartist}`, `{artist}`,
   `{year}`, `{album}`, `{disc}`, `{track}`, `{track:02}`, and `{title}`. `/`
   separates folders; Forever retains the original extension. Unknown tokens,
   absolute paths, parent traversal, duplicate destinations, and overly long
   paths are rejected. Windows-reserved characters and names are sanitized.
3. Use the retained release-group identity, or enter one, to find official
   MusicBrainz editions. Load the chosen edition and **explicitly assign** every
   file to a track. Disc position, track credit, album credit, date, release-group,
   release, and recording identities remain distinct. Manual editing is supported,
   including clearing IDs. Filename-derived starting values are only suggestions.
4. Optionally request that edition's Cover Art Archive front cover. All track
   assignments must use that edition. Artwork is limited to 8 MiB, HTTPS redirects
   are restricted to CAA/Internet Archive, and failures remain visible. Disable
   artwork to continue without it. Other embedded picture types are retained.
5. **Preview tags and paths** reads files and hashes their bytes without changing
   them. Inspect current/proposed tags, artwork, and each source/destination. Edits
   invalidate the preview. Check the review box, then **Apply filing**.

Writable containers are MP3, FLAC, M4A/MP4, Ogg Vorbis/Opus, WAV, AIFF, APE,
and WavPack. Actual parser and tag read-back success is required. Unsupported,
malformed, missing, or incomplete audio prevents filing the entire arrival.
Downloaded companions are copied unchanged, preserving their relative subfolders.
One operation is limited to 500 files. Existing destinations are never replaced;
choose a different template or root to resolve a collision.

## File transaction and recovery

The backend hashes every original with SHA-256, copies files into an exclusive
staging directory on the library volume, writes tags using Lofty, reads them
back, and flushes the staged output. The crash-safe `filing.json` journal stores
source/output hashes, reviewed paths, and original transfer snapshots before any
file is published. File I/O runs on a blocking worker, outside the transfer lock.

Windows publication uses `MoveFileExW` without `REPLACE_EXISTING`. Staging lives
on the destination volume, so download and library folders can be on different
volumes. Each original is then moved to a `.forever-undo-<operation>-<index>`
sibling on its own volume. These originals retain their exact bytes and do not
enter Forever's share index. Transfer paths, sizes, and filed state are saved and
flushed before the operation is marked complete. Soundcheck can be rerun for the
new file; stale pre-tag inspection stamps are discarded.

**Preview undo** checks all original/backup/output paths and fingerprints before
offering **Confirm undo filing**. Undo restores original bytes and transfer paths,
and removes only matching filed outputs. It is restartable after partial progress.
If an original or filed copy was edited or replaced, undo stops and preserves the
conflicting files. Empty directories are retained because they may predate filing.

An interrupted apply/undo remains visible in filing history after restart; use
its undo preview. Keep the application configuration's `filing.json` and its
validated `.bak` alongside the `.forever-undo-*` originals. Do not delete the
backups if undo is still wanted. Original retention uses roughly one extra copy
of the album; this release does not automatically prune undo data.

Transfer history can be cleared independently. This does not discard filing
history or originals; undo restores files without recreating cleared transfer
rows. Patch Bay, cancel/resume, and manual filed-state changes cannot race a filing
operation or alter a release with retained undo ownership. Undo first to resume
those operations. Links and Windows junctions are rejected throughout the path.

File changes by other programs can cause apply/undo to stop with a conflict.
Physical power-loss behavior still depends on filesystem and device flush
guarantees. An unrecoverable journal failure preserves data and blocks filing.

## Beets and Music Library

Filed operations offer a quoted PowerShell `beet import -t -- '<album folder>'`
hand-off. It is displayed and copied, never executed automatically. An installed
beets CLI provides its own interactive import review. Beets changes its own files
and database and has its own recovery behavior; Forever does not undo those
external changes. If beets changes a filed file, Forever's undo fingerprint guard
will require the conflict to be resolved before proceeding.

Filing never writes Music Library's SQLite database. Import into Music Library
through its usual workflow; Forever's existing read-only reconciliation can then
recognize ownership.

## Verification

Focused Rust tests exercise WAV tag writing with unchanged PCM bytes, FLAC tags,
embedded front artwork and unrelated comment retention, current/proposed metadata,
exact-byte undo, case/path template validation, collisions, stale sources, edited
outputs, unsafe junctions, and journal reloads at publication boundaries. Transfer
projection tests cover changed sizes, restored paths, and deliberately cleared
history. MusicBrainz fixtures cover multi-disc ordering and differing track and
album artist credits. Frontend tests exercise review gating, invalidation after
edits, error rendering, and interrupted-operation undo.

Browser checks use simulated IPC and temporary data. They do not establish live
MusicBrainz/CAA availability, public Soulseek interoperability, installed-desktop
behavior, external beets behavior, physical power-loss durability, or compatibility
with every file/container variant.

References: [Lofty](https://docs.rs/lofty/0.25.4/lofty/),
[Windows MoveFileEx](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw),
[beets import](https://docs.beets.io/en/latest/reference/cli.html#import).
