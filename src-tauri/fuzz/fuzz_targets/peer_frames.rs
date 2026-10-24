#![no_main]
libfuzzer_sys::fuzz_target!(|data: &[u8]| forever_protocol_fuzz::peer_frames(data));
