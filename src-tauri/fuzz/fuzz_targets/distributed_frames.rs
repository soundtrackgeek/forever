#![no_main]
libfuzzer_sys::fuzz_target!(|data: &[u8]| forever_protocol_fuzz::distributed_frames(data));
