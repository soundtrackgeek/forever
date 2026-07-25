use std::string::FromUtf8Error;
use thiserror::Error;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use zeroize::Zeroizing;

pub const LOGIN_CODE: u32 = 1;
pub const SET_STATUS_CODE: u32 = 28;
pub const SERVER_PING_CODE: u32 = 32;
pub const SHARED_COUNTS_CODE: u32 = 35;
pub const RELOGGED_CODE: u32 = 41;
pub const EXPERIMENTAL_MAJOR_VERSION: u32 = 177;
pub const FOREVER_MINOR_VERSION: u32 = 2;
const MAX_SERVER_MESSAGE_LENGTH: usize = 8 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub struct Frame {
    pub code: u32,
    pub payload: Vec<u8>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum LoginResponse {
    Accepted {
        greeting: String,
        supporter: bool,
    },
    Rejected {
        reason: String,
        detail: Option<String>,
    },
}

pub fn login_frame(username: &str, password: &str) -> Vec<u8> {
    let mut payload = Vec::new();
    push_string(&mut payload, username);
    push_string(&mut payload, password);
    push_u32(&mut payload, EXPERIMENTAL_MAJOR_VERSION);
    let digest_input = Zeroizing::new(format!("{username}{password}"));
    push_string(
        &mut payload,
        &format!("{:x}", md5::compute(digest_input.as_bytes())),
    );
    push_u32(&mut payload, FOREVER_MINOR_VERSION);
    encode_message(LOGIN_CODE, &payload)
}

pub fn set_online_frame() -> Vec<u8> {
    encode_message(SET_STATUS_CODE, &2_i32.to_le_bytes())
}

pub fn shared_counts_frame() -> Vec<u8> {
    let mut payload = Vec::with_capacity(8);
    push_u32(&mut payload, 0);
    push_u32(&mut payload, 0);
    encode_message(SHARED_COUNTS_CODE, &payload)
}

pub fn server_ping_frame() -> Vec<u8> {
    encode_message(SERVER_PING_CODE, &[])
}

pub fn parse_login_response(frame: &Frame) -> Result<LoginResponse, ProtocolError> {
    if frame.code != LOGIN_CODE {
        return Err(ProtocolError::UnexpectedCode {
            expected: LOGIN_CODE,
            actual: frame.code,
        });
    }

    let mut reader = PayloadReader::new(&frame.payload);
    let accepted = reader.read_bool()?;
    if accepted {
        let greeting = reader.read_string()?;
        let _own_ip = reader.read_u32()?;
        let _password_hash = reader.read_string()?;
        let supporter = reader.read_bool()?;
        Ok(LoginResponse::Accepted {
            greeting,
            supporter,
        })
    } else {
        let reason = reader.read_string()?;
        let detail = if reason == "INVALIDUSERNAME" && reader.remaining() > 0 {
            Some(reader.read_string()?)
        } else {
            None
        };
        Ok(LoginResponse::Rejected { reason, detail })
    }
}

pub async fn write_raw_frame<W>(writer: &mut W, frame: &[u8]) -> Result<(), ProtocolError>
where
    W: AsyncWrite + Unpin,
{
    writer.write_all(frame).await?;
    writer.flush().await?;
    Ok(())
}

pub async fn read_frame<R>(reader: &mut R) -> Result<Frame, ProtocolError>
where
    R: AsyncRead + Unpin,
{
    let length = reader.read_u32_le().await? as usize;
    if !(4..=MAX_SERVER_MESSAGE_LENGTH).contains(&length) {
        return Err(ProtocolError::InvalidLength(length));
    }

    let code = reader.read_u32_le().await?;
    let mut payload = vec![0; length - 4];
    reader.read_exact(&mut payload).await?;
    Ok(Frame { code, payload })
}

fn encode_message(code: u32, payload: &[u8]) -> Vec<u8> {
    let message_length = 4_usize
        .checked_add(payload.len())
        .and_then(|length| u32::try_from(length).ok())
        .expect("Soulseek message length fits in u32");
    let mut frame = Vec::with_capacity(message_length as usize + 4);
    push_u32(&mut frame, message_length);
    push_u32(&mut frame, code);
    frame.extend_from_slice(payload);
    frame
}

fn push_u32(buffer: &mut Vec<u8>, value: u32) {
    buffer.extend_from_slice(&value.to_le_bytes());
}

fn push_string(buffer: &mut Vec<u8>, value: &str) {
    let length = u32::try_from(value.len()).expect("Soulseek string length fits in u32");
    push_u32(buffer, length);
    buffer.extend_from_slice(value.as_bytes());
}

struct PayloadReader<'a> {
    payload: &'a [u8],
    position: usize,
}

impl<'a> PayloadReader<'a> {
    fn new(payload: &'a [u8]) -> Self {
        Self {
            payload,
            position: 0,
        }
    }

    fn remaining(&self) -> usize {
        self.payload.len().saturating_sub(self.position)
    }

    fn read_bool(&mut self) -> Result<bool, ProtocolError> {
        let value = *self
            .payload
            .get(self.position)
            .ok_or(ProtocolError::TruncatedPayload)?;
        self.position += 1;
        Ok(value != 0)
    }

    fn read_u32(&mut self) -> Result<u32, ProtocolError> {
        let bytes = self.read_bytes(4)?;
        Ok(u32::from_le_bytes(
            bytes.try_into().expect("four byte slice"),
        ))
    }

    fn read_string(&mut self) -> Result<String, ProtocolError> {
        let length = self.read_u32()? as usize;
        let bytes = self.read_bytes(length)?.to_vec();
        String::from_utf8(bytes).map_err(Into::into)
    }

    fn read_bytes(&mut self, length: usize) -> Result<&'a [u8], ProtocolError> {
        let end = self
            .position
            .checked_add(length)
            .ok_or(ProtocolError::TruncatedPayload)?;
        let bytes = self
            .payload
            .get(self.position..end)
            .ok_or(ProtocolError::TruncatedPayload)?;
        self.position = end;
        Ok(bytes)
    }
}

#[derive(Debug, Error)]
pub enum ProtocolError {
    #[error("Soulseek server message length {0} is invalid")]
    InvalidLength(usize),
    #[error("Soulseek message payload ended unexpectedly")]
    TruncatedPayload,
    #[error("Expected Soulseek message code {expected}, received {actual}")]
    UnexpectedCode { expected: u32, actual: u32 },
    #[error("Soulseek message text is not valid UTF-8: {0}")]
    InvalidUtf8(#[from] FromUtf8Error),
    #[error("Soulseek socket error: {0}")]
    Io(#[from] std::io::Error),
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encoded_string(value: &str) -> Vec<u8> {
        let mut result = Vec::new();
        push_string(&mut result, value);
        result
    }

    #[test]
    fn encodes_login_exactly_like_the_protocol_reference() {
        let frame = login_frame("username", "password");

        assert_eq!(u32::from_le_bytes(frame[0..4].try_into().unwrap()), 72);
        assert_eq!(
            u32::from_le_bytes(frame[4..8].try_into().unwrap()),
            LOGIN_CODE
        );
        assert!(frame
            .windows(32)
            .any(|window| window == b"d51c9a7e9353746a6020f9602d452929"));
        assert_eq!(
            u32::from_le_bytes(frame[frame.len() - 4..].try_into().unwrap()),
            FOREVER_MINOR_VERSION
        );
    }

    #[test]
    fn parses_successful_login_response() {
        let mut payload = vec![1];
        payload.extend(encoded_string("Welcome to Soulseek"));
        payload.extend(0x01020304_u32.to_le_bytes());
        payload.extend(encoded_string("password-hash"));
        payload.push(1);

        assert_eq!(
            parse_login_response(&Frame {
                code: LOGIN_CODE,
                payload,
            })
            .unwrap(),
            LoginResponse::Accepted {
                greeting: "Welcome to Soulseek".to_owned(),
                supporter: true,
            }
        );
    }

    #[test]
    fn parses_rejected_login_response_with_detail() {
        let mut payload = vec![0];
        payload.extend(encoded_string("INVALIDUSERNAME"));
        payload.extend(encoded_string("Nick too long."));

        assert_eq!(
            parse_login_response(&Frame {
                code: LOGIN_CODE,
                payload,
            })
            .unwrap(),
            LoginResponse::Rejected {
                reason: "INVALIDUSERNAME".to_owned(),
                detail: Some("Nick too long.".to_owned()),
            }
        );
    }

    #[tokio::test]
    async fn reads_a_complete_server_frame() {
        let bytes = encode_message(69, &[1, 2, 3, 4]);
        let mut source = bytes.as_slice();

        assert_eq!(
            read_frame(&mut source).await.unwrap(),
            Frame {
                code: 69,
                payload: vec![1, 2, 3, 4],
            }
        );
    }
}
