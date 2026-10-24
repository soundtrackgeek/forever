# Protocol parser fuzzing

These three cargo-fuzz targets compile the production `connection/protocol.rs`
directly, without Tauri, credentials, sockets, or filesystem writes by the parsers.
The first input byte chooses a parser; the remaining bytes are its payload. This
keeps mutations inside known message codes instead of spending most iterations
on unknown codes. `peer_frames` includes compressed search, folder, and share-list
responses, initialization, transfers, and profiles. `distributed_frames` includes
wrapped searches. All production `parse_*` entry points are exercised.

From `src-tauri`:

```sh
cargo test --manifest-path fuzz/Cargo.toml --lib
rustup toolchain install nightly --profile minimal
cargo install cargo-fuzz --locked
cargo +nightly fuzz run server_frames --features fuzzing fuzz/corpus/server_frames fuzz/seeds/server_frames -- -max_total_time=60 -max_len=65536
cargo +nightly fuzz run peer_frames --features fuzzing fuzz/corpus/peer_frames fuzz/seeds/peer_frames -- -max_total_time=60 -max_len=65536
cargo +nightly fuzz run distributed_frames --features fuzzing fuzz/corpus/distributed_frames fuzz/seeds/distributed_frames -- -max_total_time=60 -max_len=65536
```

On Windows, use a Visual Studio developer shell with the installed x64
`clang_rt.asan_dynamic-x86_64.dll` directory on `PATH`. See the
[Rust Fuzz Book Windows setup](https://rust-fuzz.github.io/book/cargo-fuzz/windows/setup.html).
Only the fuzz build uses nightly; the app continues to build on stable Rust.

Reviewed seeds are tracked under `seeds/`. Generated corpus additions, crash
artifacts, coverage, and binaries are ignored. Preserve any failure, minimize it
with `cargo +nightly fuzz tmin`, and add a normal regression test before fixing it.
The CI smoke campaign is time-bounded; it is not an exhaustive fuzzing claim or a
live Soulseek interoperability test. Run longer campaigns before parser changes.

The harness has a separate lockfile. Update it alongside parser dependency
updates in the app. Clean its build output with
`cargo clean --manifest-path fuzz/Cargo.toml` before the app's final `cargo clean`.
