// Compile the exact production parser source, without linking the desktop app.
#[path = "../../src/connection/protocol.rs"]
pub mod protocol;

use protocol::*;

macro_rules! parse_one {
    ($selector:expr, $payload:expr, $(($code:expr, $parser:path)),+ $(,)?) => {{
        let parsers: &[(u32, fn(&Frame))] = &[
            $(($code, |frame| { let _ = $parser(frame); })),+
        ];
        let (code, parse) = parsers[usize::from($selector) % parsers.len()];
        parse(&Frame { code, payload: $payload.to_vec() });
    }};
}

pub fn server_frames(data: &[u8]) {
    let Some((&selector, payload)) = data.split_first() else {
        return;
    };
    parse_one!(
        selector,
        payload,
        (LOGIN_CODE, parse_login_response),
        (GET_PEER_ADDRESS_CODE, parse_peer_address),
        (CONNECT_TO_PEER_CODE, parse_connect_to_peer),
        (CANT_CONNECT_TO_PEER_CODE, parse_cant_connect_token),
        (FILE_SEARCH_CODE, parse_server_search_request),
        (MESSAGE_USER_CODE, parse_private_message),
        (PRIVILEGED_USERS_CODE, parse_privileged_users),
        (WISHLIST_INTERVAL_CODE, parse_wishlist_interval),
        (EXCLUDED_SEARCH_PHRASES_CODE, parse_excluded_search_phrases),
        (ROOM_LIST_CODE, parse_room_list),
        (JOIN_ROOM_CODE, parse_join_room),
        (LEAVE_ROOM_CODE, parse_leave_room),
        (USER_JOINED_ROOM_CODE, parse_user_joined_room),
        (USER_LEFT_ROOM_CODE, parse_user_left_room),
        (SAY_CHATROOM_CODE, parse_room_chat_message),
        (WATCH_USER_CODE, parse_watch_user),
        (USER_STATUS_CODE, parse_user_status),
        (USER_STATS_CODE, parse_user_stats),
        (USER_INTERESTS_CODE, parse_user_interests),
        (POSSIBLE_PARENTS_CODE, parse_possible_parents),
    );
}

pub fn peer_frames(data: &[u8]) {
    let Some((&selector, payload)) = data.split_first() else {
        return;
    };
    // Initialization codes and filenames also have parameterized entry points.
    let _ = parse_peer_init(selector % 2, payload);
    let frame = Frame {
        code: QUEUE_UPLOAD_CODE,
        payload: payload.to_vec(),
    };
    let _ = parse_filename(&frame, QUEUE_UPLOAD_CODE);
    parse_one!(
        selector,
        payload,
        (FILE_SEARCH_RESPONSE_CODE, parse_search_response),
        (FOLDER_CONTENTS_REQUEST_CODE, parse_folder_contents_request),
        (
            FOLDER_CONTENTS_RESPONSE_CODE,
            parse_folder_contents_response
        ),
        (
            SHARED_FILE_LIST_RESPONSE_CODE,
            parse_shared_file_list_response
        ),
        (TRANSFER_REQUEST_CODE, parse_transfer_request),
        (TRANSFER_RESPONSE_CODE, parse_transfer_response),
        (PLACE_IN_QUEUE_RESPONSE_CODE, parse_queue_position),
        (UPLOAD_DENIED_CODE, parse_upload_denied),
        (USER_INFO_RESPONSE_CODE, parse_user_info_response),
    );
}

pub fn distributed_frames(data: &[u8]) {
    let Some((&selector, payload)) = data.split_first() else {
        return;
    };
    match selector % 4 {
        0 => {
            let _ = parse_distributed_search(&DistributedFrame {
                code: DISTRIBUTED_SEARCH_CODE,
                payload: payload.to_vec(),
            });
        }
        1 => {
            let _ = parse_distributed_branch_level(&DistributedFrame {
                code: DISTRIBUTED_BRANCH_LEVEL_CODE,
                payload: payload.to_vec(),
            });
        }
        2 => {
            let _ = parse_distributed_branch_root(&DistributedFrame {
                code: DISTRIBUTED_BRANCH_ROOT_CODE,
                payload: payload.to_vec(),
            });
        }
        _ => {
            let _ = parse_embedded_distributed_search(&Frame {
                code: EMBEDDED_MESSAGE_CODE,
                payload: payload.to_vec(),
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_parser_routes_tolerate_truncation_and_extreme_lengths() {
        for selector in 0..=u8::MAX {
            for bytes in [vec![], vec![0; 128], vec![255; 128]] {
                let mut input = vec![selector];
                input.extend(bytes);
                for length in 1..=input.len() {
                    server_frames(&input[..length]);
                    peer_frames(&input[..length]);
                    distributed_frames(&input[..length]);
                }
            }
        }
    }
}
