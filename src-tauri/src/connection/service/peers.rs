use super::super::branch::ChildCandidate;
use super::super::downloads::{DownloadPlan, TransferHub, TransferTicket};
use super::super::folders::FolderTicket;
use super::super::local_shares::{LocalSharesHub, SearchResponseOrigin, SearchResponseTicket};
use super::super::people::{PeopleHub, ProfileTicket};
use super::super::protocol::{
    file_search_response_frame, folder_contents_request_frame, folder_contents_response_frame,
    parse_filename, parse_folder_contents_request, parse_folder_contents_response,
    parse_queue_position, parse_search_response, parse_shared_file_list_response,
    parse_transfer_request, parse_transfer_response, parse_upload_denied, parse_user_info_response,
    peer_init_frame, pierce_firewall_frame, place_in_queue_request_frame,
    place_in_queue_response_frame, queue_upload_frame, read_peer_frame, read_peer_init,
    read_profile_frame, shared_file_list_request_frame, shared_file_list_response_frame,
    transfer_request_frame, transfer_response_frame, upload_denied_frame, user_info_request_frame,
    user_info_response_frame, write_raw_frame, ConnectToPeer, PeerAddress, PeerInit, ProtocolError,
    FILE_SEARCH_RESPONSE_CODE, FOLDER_CONTENTS_REQUEST_CODE, FOLDER_CONTENTS_RESPONSE_CODE,
    PLACE_IN_QUEUE_REQUEST_CODE, PLACE_IN_QUEUE_RESPONSE_CODE, QUEUE_UPLOAD_CODE,
    SHARED_FILE_LIST_REQUEST_CODE, SHARED_FILE_LIST_RESPONSE_CODE, TRANSFER_REQUEST_CODE,
    UPLOAD_DENIED_CODE, UPLOAD_FAILED_CODE, USER_INFO_REQUEST_CODE, USER_INFO_RESPONSE_CODE,
};
use super::super::shares::SharesTicket;
use super::super::uploads::{UploadHub, UploadTicket};
use super::{
    ConnectionCommand, PeerMessagePurpose, PeerServices, FILE_BUFFER_SIZE, PEER_CONNECT_TIMEOUT,
    PEER_IDLE_TIMEOUT, PEER_MESSAGE_TIMEOUT, TRANSFER_REQUEST_TIMEOUT,
};
use std::io::SeekFrom;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::fs::{File, OpenOptions};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, Semaphore};
use tokio::time::timeout;

// Direct/indirect peer negotiation and file IO.

pub(super) fn spawn_direct_peer(
    stream: TcpStream,
    services: PeerServices,
    limit: Arc<Semaphore>,
    children: mpsc::Sender<ChildCandidate>,
) {
    let Ok(permit) = limit.try_acquire_owned() else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        let _permit = permit;
        let _ = handle_direct_peer(stream, services, children).await;
    });
}

pub(super) fn spawn_indirect_child(
    request: ConnectToPeer,
    children: mpsc::Sender<ChildCandidate>,
    limit: Arc<Semaphore>,
) {
    if request.port == 0 || request.port > u16::MAX.into() {
        return;
    }
    let Ok(permit) = limit.try_acquire_owned() else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        let _permit = permit;
        let Ok(Ok(mut stream)) = timeout(
            PEER_CONNECT_TIMEOUT,
            TcpStream::connect((request.address, request.port as u16)),
        )
        .await
        else {
            return;
        };
        if !matches!(
            timeout(
                PEER_MESSAGE_TIMEOUT,
                write_raw_frame(&mut stream, &pierce_firewall_frame(request.token))
            )
            .await,
            Ok(Ok(()))
        ) {
            return;
        }
        let _ = children.try_send(ChildCandidate {
            username: request.username,
            stream,
        });
    });
}

pub(super) fn spawn_indirect_peer(
    request: ConnectToPeer,
    services: PeerServices,
    limit: Arc<Semaphore>,
) {
    if !matches!(request.connection_type.as_str(), "P" | "F")
        || request.port == 0
        || request.port > u16::MAX.into()
    {
        return;
    }
    let Ok(permit) = limit.try_acquire_owned() else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        let _permit = permit;
        if handle_indirect_peer(&request, services.clone())
            .await
            .is_err()
        {
            services.local_shares.fail_search(request.token);
            if services.uploads.fail_connection(
                request.token,
                "The downloader peer connection failed.".to_owned(),
            ) {
                let _ = services
                    .command_sender
                    .send(ConnectionCommand::ScheduleUploads);
            }
            services.folders.fail_connection(
                request.token,
                "The source peer connection failed before the folder could be read.".to_owned(),
            );
            services.shares.fail_connection(
                request.token,
                "The source peer connection failed before the share list could be read.".to_owned(),
            );
            let _ = services
                .command_sender
                .send(ConnectionCommand::PeerConnectionFailed {
                    token: request.token,
                    username: request.username,
                });
        }
    });
}

pub(super) async fn handle_direct_peer(
    mut stream: TcpStream,
    services: PeerServices,
    children: mpsc::Sender<ChildCandidate>,
) -> Result<(), ProtocolError> {
    let _ = stream.set_nodelay(true);
    let init = timeout(PEER_MESSAGE_TIMEOUT, read_peer_init(&mut stream))
        .await
        .map_err(|_| peer_timeout_error())??;
    match init {
        PeerInit::Peer {
            username,
            connection_type,
            ..
        } if connection_type == "D" => {
            let _ = children.try_send(ChildCandidate { username, stream });
            Ok(())
        }
        PeerInit::PierceFirewall { token } => {
            if let Some(ticket) = services.uploads.claim_file(token) {
                stream.write_u32_le(ticket.transfer_token).await?;
                stream.flush().await?;
                spawn_file_upload(
                    stream,
                    ticket,
                    services.uploads,
                    services.local_shares,
                    services.people,
                    services.command_sender,
                );
            } else if let Some(ticket) = services.uploads.claim_control(token) {
                negotiate_upload_on_peer(&mut stream, ticket, services).await?;
            } else if let Some(ticket) = services.local_shares.claim_search(token) {
                send_search_response_on_peer(&mut stream, ticket, &services).await?;
            } else if let Some(ticket) = services.people.claim_profile(token) {
                request_profile_on_peer(&mut stream, ticket, services).await?;
            } else if let Some(ticket) = services.transfers.claim_peer(token) {
                if let Err(error) =
                    queue_download_on_peer(&mut stream, ticket.clone(), services.clone()).await
                {
                    if services.transfers.retry_peer(
                        &ticket.id,
                        ticket.connection_token,
                        format!("The source connection ended before the file was queued: {error}"),
                    ) {
                        let _ = services
                            .command_sender
                            .send(ConnectionCommand::ScheduleDownloads);
                    }
                }
            } else if let Some(ticket) = services.folders.claim_peer(token) {
                if let Err(error) =
                    browse_folder_on_peer(&mut stream, ticket.clone(), services.clone()).await
                {
                    services.folders.fail_connection(
                        ticket.connection_token,
                        format!("The folder connection ended before the source answered: {error}"),
                    );
                }
            } else if let Some(ticket) = services.shares.claim_peer(token) {
                if let Err(error) =
                    browse_shares_on_peer(&mut stream, ticket.clone(), services.clone()).await
                {
                    services.shares.fail_connection(
                        ticket.connection_token,
                        format!(
                            "The share-list connection ended before the source answered: {error}"
                        ),
                    );
                }
            }
            Ok(())
        }
        PeerInit::Peer {
            username,
            connection_type,
            ..
        } if connection_type == "P" => {
            handle_peer_messages(
                &mut stream,
                &username,
                services,
                PeerMessagePurpose::General,
            )
            .await
        }
        PeerInit::Peer {
            connection_type, ..
        } if connection_type == "F" => {
            let transfer_token = timeout(PEER_MESSAGE_TIMEOUT, stream.read_u32_le())
                .await
                .map_err(|_| peer_timeout_error())??;
            spawn_file_download(
                stream,
                transfer_token,
                services.transfers,
                services.command_sender,
            );
            Ok(())
        }
        _ => Ok(()),
    }
}

pub(super) async fn handle_indirect_peer(
    request: &ConnectToPeer,
    services: PeerServices,
) -> Result<(), ProtocolError> {
    let mut stream = timeout(
        PEER_CONNECT_TIMEOUT,
        TcpStream::connect((request.address, request.port as u16)),
    )
    .await
    .map_err(|_| peer_timeout_error())??;
    let _ = stream.set_nodelay(true);
    write_raw_frame(&mut stream, &pierce_firewall_frame(request.token)).await?;
    if request.connection_type == "F" {
        if let Some(ticket) = services.uploads.claim_file(request.token) {
            stream.write_u32_le(ticket.transfer_token).await?;
            stream.flush().await?;
            spawn_file_upload(
                stream,
                ticket,
                services.uploads,
                services.local_shares,
                services.people,
                services.command_sender,
            );
            return Ok(());
        }
        let transfer_token = timeout(PEER_MESSAGE_TIMEOUT, stream.read_u32_le())
            .await
            .map_err(|_| peer_timeout_error())??;
        spawn_file_download(
            stream,
            transfer_token,
            services.transfers,
            services.command_sender,
        );
        return Ok(());
    }
    if let Some(ticket) = services.uploads.claim_control(request.token) {
        return negotiate_upload_on_peer(&mut stream, ticket, services).await;
    }
    if let Some(ticket) = services.local_shares.claim_search(request.token) {
        return send_search_response_on_peer(&mut stream, ticket, &services).await;
    }
    if let Some(ticket) = services.people.claim_profile(request.token) {
        return request_profile_on_peer(&mut stream, ticket, services).await;
    }
    if let Some(ticket) = services.folders.claim_peer(request.token) {
        return browse_folder_on_peer(&mut stream, ticket, services).await;
    }
    if let Some(ticket) = services.shares.claim_peer(request.token) {
        return browse_shares_on_peer(&mut stream, ticket, services).await;
    }
    handle_peer_messages(
        &mut stream,
        &request.username,
        services,
        PeerMessagePurpose::General,
    )
    .await
}

pub(super) fn spawn_outbound_search_response_peer(
    address: PeerAddress,
    ticket: SearchResponseTicket,
    own_username: String,
    services: PeerServices,
    limit: Arc<Semaphore>,
) {
    if address.port == 0 || address.port > u16::MAX.into() {
        return;
    }
    let Ok(permit) = limit.try_acquire_owned() else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        let _permit = permit;
        let connection_token = ticket.connection_token;
        let Ok(Ok(mut stream)) = timeout(
            PEER_CONNECT_TIMEOUT,
            TcpStream::connect((address.address, address.port as u16)),
        )
        .await
        else {
            services.local_shares.fail_search(connection_token);
            return;
        };
        let _ = stream.set_nodelay(true);
        if write_raw_frame(&mut stream, &peer_init_frame(&own_username, "P"))
            .await
            .is_err()
        {
            services.local_shares.fail_search(connection_token);
            return;
        }
        let Some(claimed) = services.local_shares.claim_search(ticket.connection_token) else {
            return;
        };
        let _ = send_search_response_on_peer(&mut stream, claimed, &services).await;
    });
}

pub(super) fn spawn_outbound_upload_control_peer(
    address: PeerAddress,
    ticket: UploadTicket,
    own_username: String,
    services: PeerServices,
    limit: Arc<Semaphore>,
) {
    if address.port == 0 || address.port > u16::MAX.into() {
        return;
    }
    let Ok(permit) = limit.try_acquire_owned() else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        let _permit = permit;
        let result = async {
            let mut stream = timeout(
                PEER_CONNECT_TIMEOUT,
                TcpStream::connect((address.address, address.port as u16)),
            )
            .await
            .map_err(|_| peer_timeout_error())??;
            let _ = stream.set_nodelay(true);
            write_raw_frame(&mut stream, &peer_init_frame(&own_username, "P")).await?;
            let claimed = services
                .uploads
                .claim_control(ticket.connection_token)
                .ok_or_else(peer_timeout_error)?;
            negotiate_upload_on_peer(&mut stream, claimed, services.clone()).await
        }
        .await;
        if let Err(error) = result {
            if services.uploads.fail_connection(
                ticket.connection_token,
                format!("The downloader did not accept the upload: {error}"),
            ) {
                let _ = services
                    .command_sender
                    .send(ConnectionCommand::ScheduleUploads);
            }
        }
    });
}

pub(super) fn spawn_outbound_upload_file_peer(
    address: PeerAddress,
    ticket: UploadTicket,
    own_username: String,
    services: PeerServices,
    limit: Arc<Semaphore>,
) {
    if address.port == 0 || address.port > u16::MAX.into() {
        return;
    }
    let Ok(permit) = limit.try_acquire_owned() else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        let _permit = permit;
        let Ok(Ok(mut stream)) = timeout(
            PEER_CONNECT_TIMEOUT,
            TcpStream::connect((address.address, address.port as u16)),
        )
        .await
        else {
            return;
        };
        let _ = stream.set_nodelay(true);
        if write_raw_frame(&mut stream, &peer_init_frame(&own_username, "F"))
            .await
            .is_err()
        {
            return;
        }
        let Some(claimed) = services.uploads.claim_file(ticket.connection_token) else {
            return;
        };
        if stream.write_u32_le(claimed.transfer_token).await.is_err()
            || stream.flush().await.is_err()
        {
            services.uploads.fail_attempt(
                &claimed.id,
                claimed.transfer_token,
                "The upload file connection could not be started.".to_owned(),
            );
            let _ = services
                .command_sender
                .send(ConnectionCommand::ScheduleUploads);
            return;
        }
        spawn_file_upload(
            stream,
            claimed,
            services.uploads,
            services.local_shares,
            services.people,
            services.command_sender,
        );
    });
}

pub(super) async fn send_search_response_on_peer(
    stream: &mut TcpStream,
    mut ticket: SearchResponseTicket,
    services: &PeerServices,
) -> Result<(), ProtocolError> {
    // The server may replace its list while the peer connection is opening.
    services
        .local_shares
        .filter_search_response(&mut ticket.files);
    if ticket.files.is_empty() {
        return Ok(());
    }
    let frame = file_search_response_frame(
        &services.own_username,
        ticket.search_token,
        &ticket.files,
        services
            .uploads
            .has_free_slot(services.local_shares.upload_slots()),
        0,
        services.uploads.queued_count(),
    )?;
    write_raw_frame(stream, &frame).await?;
    if ticket.origin == SearchResponseOrigin::Distributed {
        services.distributed.record_answered();
    }
    Ok(())
}

pub(super) async fn negotiate_upload_on_peer(
    stream: &mut TcpStream,
    ticket: UploadTicket,
    services: PeerServices,
) -> Result<(), ProtocolError> {
    write_raw_frame(
        stream,
        &transfer_request_frame(
            ticket.transfer_token,
            &ticket.remote_filename,
            ticket.size_bytes,
        ),
    )
    .await?;
    let frame = timeout(PEER_MESSAGE_TIMEOUT, read_peer_frame(stream))
        .await
        .map_err(|_| peer_timeout_error())??;
    let (token, allowed, reason) = parse_transfer_response(&frame)?;
    if token != ticket.transfer_token || !allowed {
        services.uploads.fail_attempt(
            &ticket.id,
            ticket.transfer_token,
            reason.unwrap_or_else(|| "The downloader declined the upload.".to_owned()),
        );
        let _ = services
            .command_sender
            .send(ConnectionCommand::ScheduleUploads);
        return Ok(());
    }
    let _ = services
        .command_sender
        .send(ConnectionCommand::OpenUploadFile { id: ticket.id });
    Ok(())
}

pub(super) fn spawn_outbound_download_peer(
    address: PeerAddress,
    ticket: TransferTicket,
    own_username: String,
    services: PeerServices,
    limit: Arc<Semaphore>,
) {
    if address.port == 0 || address.port > u16::MAX.into() {
        return;
    }
    let Ok(permit) = limit.try_acquire_owned() else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        let PeerServices {
            search,
            wanted,
            radar,
            folders,
            shares,
            people,
            transfers,
            local_shares,
            uploads,
            distributed,
            own_username: service_username,
            command_sender,
        } = services;
        let _permit = permit;
        let Ok(Ok(mut stream)) = timeout(
            PEER_CONNECT_TIMEOUT,
            TcpStream::connect((address.address, address.port as u16)),
        )
        .await
        else {
            return;
        };
        let _ = stream.set_nodelay(true);
        if write_raw_frame(&mut stream, &peer_init_frame(&own_username, "P"))
            .await
            .is_err()
        {
            return;
        }
        let Some(claimed) = transfers.claim_peer(ticket.connection_token) else {
            return;
        };
        if let Err(error) = queue_download_on_peer(
            &mut stream,
            claimed.clone(),
            PeerServices {
                search,
                wanted,
                radar,
                folders,
                shares,
                people,
                transfers: transfers.clone(),
                local_shares,
                uploads,
                distributed,
                own_username: service_username,
                command_sender: command_sender.clone(),
            },
        )
        .await
        {
            if transfers.retry_peer(
                &claimed.id,
                claimed.connection_token,
                format!("The source connection ended before the file was queued: {error}"),
            ) {
                let _ = command_sender.send(ConnectionCommand::ScheduleDownloads);
            }
        }
    });
}

pub(super) fn spawn_outbound_folder_peer(
    address: PeerAddress,
    ticket: FolderTicket,
    own_username: String,
    services: PeerServices,
    limit: Arc<Semaphore>,
) {
    if address.port == 0 || address.port > u16::MAX.into() {
        return;
    }
    let Ok(permit) = limit.try_acquire_owned() else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        let PeerServices {
            search,
            wanted,
            radar,
            folders,
            shares,
            people,
            transfers,
            local_shares,
            uploads,
            distributed,
            own_username: service_username,
            command_sender,
        } = services;
        let _permit = permit;
        let Ok(Ok(mut stream)) = timeout(
            PEER_CONNECT_TIMEOUT,
            TcpStream::connect((address.address, address.port as u16)),
        )
        .await
        else {
            return;
        };
        let _ = stream.set_nodelay(true);
        if write_raw_frame(&mut stream, &peer_init_frame(&own_username, "P"))
            .await
            .is_err()
        {
            return;
        }
        let Some(claimed) = folders.claim_peer(ticket.connection_token) else {
            return;
        };
        if let Err(error) = browse_folder_on_peer(
            &mut stream,
            claimed.clone(),
            PeerServices {
                search,
                wanted,
                radar,
                folders: folders.clone(),
                shares,
                people,
                transfers,
                local_shares,
                uploads,
                distributed,
                own_username: service_username,
                command_sender,
            },
        )
        .await
        {
            folders.fail_connection(
                claimed.connection_token,
                format!("The folder connection ended before the source answered: {error}"),
            );
        }
    });
}

pub(super) fn spawn_outbound_shares_peer(
    address: PeerAddress,
    ticket: SharesTicket,
    own_username: String,
    services: PeerServices,
    limit: Arc<Semaphore>,
) {
    if address.port == 0 || address.port > u16::MAX.into() {
        return;
    }
    let Ok(permit) = limit.try_acquire_owned() else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        let _permit = permit;
        let Ok(Ok(mut stream)) = timeout(
            PEER_CONNECT_TIMEOUT,
            TcpStream::connect((address.address, address.port as u16)),
        )
        .await
        else {
            return;
        };
        let _ = stream.set_nodelay(true);
        if write_raw_frame(&mut stream, &peer_init_frame(&own_username, "P"))
            .await
            .is_err()
        {
            return;
        }
        let Some(claimed) = services.shares.claim_peer(ticket.connection_token) else {
            return;
        };
        if let Err(error) =
            browse_shares_on_peer(&mut stream, claimed.clone(), services.clone()).await
        {
            services.shares.fail_connection(
                claimed.connection_token,
                format!("The share-list connection ended before the source answered: {error}"),
            );
        }
    });
}

pub(super) fn spawn_outbound_profile_peer(
    address: PeerAddress,
    ticket: ProfileTicket,
    own_username: String,
    services: PeerServices,
    limit: Arc<Semaphore>,
) {
    if address.port == 0 || address.port > u16::MAX.into() {
        services.people.fail_profile(
            ticket.connection_token,
            "The user is not accepting profile connections.".to_owned(),
        );
        return;
    }
    let Ok(permit) = limit.try_acquire_owned() else {
        services.people.fail_profile(
            ticket.connection_token,
            "Forever is handling too many peer connections to open this profile.".to_owned(),
        );
        return;
    };
    tauri::async_runtime::spawn(async move {
        let _permit = permit;
        let result = async {
            let mut stream = timeout(
                PEER_CONNECT_TIMEOUT,
                TcpStream::connect((address.address, address.port as u16)),
            )
            .await
            .map_err(|_| peer_timeout_error())??;
            let _ = stream.set_nodelay(true);
            write_raw_frame(&mut stream, &peer_init_frame(&own_username, "P")).await?;
            let claimed = services
                .people
                .claim_profile(ticket.connection_token)
                .ok_or_else(peer_timeout_error)?;
            request_profile_on_peer(&mut stream, claimed, services.clone()).await
        }
        .await;
        if let Err(error) = result {
            services.people.fail_profile(
                ticket.connection_token,
                format!("The user profile connection ended before a response arrived: {error}"),
            );
        }
    });
}

pub(super) async fn queue_download_on_peer(
    stream: &mut TcpStream,
    ticket: TransferTicket,
    services: PeerServices,
) -> Result<(), ProtocolError> {
    write_raw_frame(stream, &queue_upload_frame(&ticket.remote_filename)).await?;
    write_raw_frame(
        stream,
        &place_in_queue_request_frame(&ticket.remote_filename),
    )
    .await?;
    handle_peer_messages(
        stream,
        &ticket.username,
        services,
        PeerMessagePurpose::Transfer,
    )
    .await
}

pub(super) async fn browse_folder_on_peer(
    stream: &mut TcpStream,
    ticket: FolderTicket,
    services: PeerServices,
) -> Result<(), ProtocolError> {
    write_raw_frame(
        stream,
        &folder_contents_request_frame(ticket.folder_token, &ticket.folder),
    )
    .await?;
    handle_peer_messages(
        stream,
        &ticket.username,
        services,
        PeerMessagePurpose::Folder,
    )
    .await
}

pub(super) async fn browse_shares_on_peer(
    stream: &mut TcpStream,
    ticket: SharesTicket,
    services: PeerServices,
) -> Result<(), ProtocolError> {
    write_raw_frame(stream, &shared_file_list_request_frame()).await?;
    handle_peer_messages(
        stream,
        &ticket.username,
        services,
        PeerMessagePurpose::Shares(ticket.connection_token),
    )
    .await
}

pub(super) async fn request_profile_on_peer(
    stream: &mut TcpStream,
    ticket: ProfileTicket,
    services: PeerServices,
) -> Result<(), ProtocolError> {
    write_raw_frame(stream, &user_info_request_frame()).await?;
    handle_peer_messages(
        stream,
        &ticket.username,
        services,
        PeerMessagePurpose::Profile(ticket.connection_token),
    )
    .await
}

pub(super) async fn handle_peer_messages(
    stream: &mut TcpStream,
    username: &str,
    services: PeerServices,
    purpose: PeerMessagePurpose,
) -> Result<(), ProtocolError> {
    if !username.eq_ignore_ascii_case(&services.own_username) && services.people.observe(username) {
        let _ = services
            .command_sender
            .send(ConnectionCommand::WatchPerson {
                username: username.to_owned(),
            });
    }
    loop {
        let frame_result = match purpose {
            PeerMessagePurpose::Profile(_) => {
                timeout(PEER_IDLE_TIMEOUT, read_profile_frame(stream)).await
            }
            _ => timeout(PEER_IDLE_TIMEOUT, read_peer_frame(stream)).await,
        };
        let expects_response = matches!(
            purpose,
            PeerMessagePurpose::Folder
                | PeerMessagePurpose::Shares(_)
                | PeerMessagePurpose::Profile(_)
        );
        let frame = match frame_result {
            Ok(Ok(frame)) => frame,
            Ok(Err(ProtocolError::Io(error)))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::UnexpectedEof
                        | std::io::ErrorKind::ConnectionReset
                        | std::io::ErrorKind::ConnectionAborted
                        | std::io::ErrorKind::BrokenPipe
                ) =>
            {
                if expects_response {
                    return Err(error.into());
                }
                return Ok(());
            }
            Ok(Err(error)) => return Err(error),
            Err(_) if expects_response => return Err(peer_timeout_error()),
            Err(_) => return Ok(()),
        };
        match frame.code {
            USER_INFO_REQUEST_CODE => {
                let response = user_info_response_frame(
                    "Sharing music with Forever.",
                    None,
                    u32::try_from(services.local_shares.upload_slots()).unwrap_or(u32::MAX),
                    services.uploads.queued_count(),
                    services
                        .uploads
                        .has_free_slot(services.local_shares.upload_slots()),
                    1,
                )?;
                write_raw_frame(stream, &response).await?;
            }
            USER_INFO_RESPONSE_CODE => {
                if let PeerMessagePurpose::Profile(connection_token) = purpose {
                    services.people.resolve_user_info(
                        connection_token,
                        username,
                        parse_user_info_response(&frame)?,
                    );
                    return Ok(());
                }
            }
            SHARED_FILE_LIST_REQUEST_CODE => {
                let shares = if services.people.is_blocked(username) {
                    Vec::new()
                } else {
                    services.local_shares.share_list()
                };
                let response = shared_file_list_response_frame(&shares)?;
                write_raw_frame(stream, &response).await?;
            }
            FOLDER_CONTENTS_REQUEST_CODE => {
                let (token, folder) = parse_folder_contents_request(&frame)?;
                let folders = if services.people.is_blocked(username) {
                    Vec::new()
                } else {
                    services.local_shares.folder_list(&folder)
                };
                let response = folder_contents_response_frame(token, &folder, &folders)?;
                write_raw_frame(stream, &response).await?;
            }
            QUEUE_UPLOAD_CODE => {
                let filename = parse_filename(&frame, QUEUE_UPLOAD_CODE)?;
                if services.people.is_blocked(username) {
                    write_raw_frame(
                        stream,
                        &upload_denied_frame(&filename, "Banned by the sharing user."),
                    )
                    .await?;
                } else if let Some(file) = services.local_shares.resolve_file(&filename) {
                    match services.uploads.enqueue(username, file) {
                        Ok(_) => {
                            let _ = services
                                .command_sender
                                .send(ConnectionCommand::ScheduleUploads);
                        }
                        Err(error) => {
                            write_raw_frame(
                                stream,
                                &upload_denied_frame(&filename, &error.to_string()),
                            )
                            .await?;
                        }
                    }
                } else {
                    write_raw_frame(
                        stream,
                        &upload_denied_frame(&filename, "File is not shared."),
                    )
                    .await?;
                }
            }
            PLACE_IN_QUEUE_REQUEST_CODE => {
                let filename = parse_filename(&frame, PLACE_IN_QUEUE_REQUEST_CODE)?;
                if services.people.is_blocked(username) {
                    write_raw_frame(
                        stream,
                        &upload_denied_frame(&filename, "Banned by the sharing user."),
                    )
                    .await?;
                } else if let Some(position) = services.uploads.queue_position(username, &filename)
                {
                    write_raw_frame(stream, &place_in_queue_response_frame(&filename, position))
                        .await?;
                } else {
                    write_raw_frame(
                        stream,
                        &upload_denied_frame(&filename, "File is not queued."),
                    )
                    .await?;
                }
            }
            FILE_SEARCH_RESPONSE_CODE => {
                let response = parse_search_response(&frame)?;
                if services.people.is_ignored(&response.username) {
                    if purpose == PeerMessagePurpose::General {
                        return Ok(());
                    }
                    continue;
                }
                if services.people.observe(&response.username) {
                    let _ = services
                        .command_sender
                        .send(ConnectionCommand::WatchPerson {
                            username: response.username.clone(),
                        });
                }
                services.wanted.record(&response);
                services.radar.record(&response);
                services.search.record(response);
                if purpose == PeerMessagePurpose::General {
                    return Ok(());
                }
            }
            FOLDER_CONTENTS_RESPONSE_CODE
                if services
                    .folders
                    .resolve(username, parse_folder_contents_response(&frame)?) =>
            {
                return Ok(())
            }
            FOLDER_CONTENTS_RESPONSE_CODE => {}
            SHARED_FILE_LIST_RESPONSE_CODE => {
                if let PeerMessagePurpose::Shares(connection_token) = purpose {
                    services.shares.resolve(
                        connection_token,
                        username,
                        parse_shared_file_list_response(&frame)?,
                    );
                    return Ok(());
                }
            }
            TRANSFER_REQUEST_CODE => {
                let request = parse_transfer_request(&frame)?;
                let accepted = request.direction == 1
                    && request.size_bytes.is_some_and(|size| {
                        services
                            .transfers
                            .accept_upload_request(username, &request.filename, request.token, size)
                            .is_some()
                    });
                write_raw_frame(
                    stream,
                    &transfer_response_frame(
                        request.token,
                        accepted,
                        (!accepted).then_some("Cancelled"),
                    ),
                )
                .await?;
                if !accepted
                    && services.transfers.fail_for_filename(
                        username,
                        &request.filename,
                        "The source reported a different file size than the search result."
                            .to_owned(),
                    )
                {
                    let _ = services
                        .command_sender
                        .send(ConnectionCommand::ScheduleDownloads);
                }
            }
            PLACE_IN_QUEUE_RESPONSE_CODE => {
                let (filename, position) = parse_queue_position(&frame)?;
                services
                    .transfers
                    .set_queue_position(username, &filename, position);
            }
            UPLOAD_FAILED_CODE => {
                let filename = parse_filename(&frame, UPLOAD_FAILED_CODE)?;
                if services.transfers.retry_for_filename(
                    username,
                    &filename,
                    "The source stopped the upload before the file completed.".to_owned(),
                ) {
                    let _ = services
                        .command_sender
                        .send(ConnectionCommand::ScheduleDownloads);
                }
            }
            UPLOAD_DENIED_CODE => {
                let (filename, reason) = parse_upload_denied(&frame)?;
                if services.transfers.deny_for_filename(
                    username,
                    &filename,
                    format!("The source declined the download: {reason}"),
                ) {
                    let _ = services
                        .command_sender
                        .send(ConnectionCommand::ScheduleDownloads);
                }
            }
            _ => {}
        }
    }
}

pub(super) fn spawn_transfer_request_timeout(
    ticket: TransferTicket,
    transfers: TransferHub,
    command_sender: mpsc::UnboundedSender<ConnectionCommand>,
) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(TRANSFER_REQUEST_TIMEOUT).await;
        if transfers.retry_connection(
            ticket.connection_token,
            "The source did not answer the peer connection request.".to_owned(),
        ) {
            let _ = command_sender.send(ConnectionCommand::ScheduleDownloads);
        }
    });
}

pub(super) fn spawn_upload_request_timeout(
    ticket: UploadTicket,
    uploads: UploadHub,
    command_sender: mpsc::UnboundedSender<ConnectionCommand>,
) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(TRANSFER_REQUEST_TIMEOUT).await;
        if uploads.fail_connection(
            ticket.connection_token,
            "The downloader did not answer the upload connection request.".to_owned(),
        ) {
            let _ = command_sender.send(ConnectionCommand::ScheduleUploads);
        }
    });
}

pub(super) fn spawn_file_download(
    stream: TcpStream,
    transfer_token: u32,
    transfers: TransferHub,
    command_sender: mpsc::UnboundedSender<ConnectionCommand>,
) {
    let plan = match transfers.begin_file(transfer_token) {
        Ok(plan) => plan,
        Err(error) => {
            if transfers.fail_transfer_token(transfer_token, error.to_string()) {
                let _ = command_sender.send(ConnectionCommand::ScheduleDownloads);
            }
            return;
        }
    };
    let id = plan.id.clone();
    let cancellation = Arc::new(AtomicBool::new(false));
    if !transfers.register_task(id.clone(), transfer_token, cancellation.clone()) {
        return;
    }
    let task_transfers = transfers.clone();
    let task_id = id.clone();
    tauri::async_runtime::spawn(async move {
        let outcome = receive_file(stream, &plan, task_transfers.clone(), cancellation).await;
        if let Err(message) = outcome {
            if retryable_download_error(&message) {
                task_transfers.retry_attempt(&task_id, transfer_token, message);
            } else {
                task_transfers.fail_attempt(&task_id, transfer_token, message);
            }
        }
        task_transfers.unregister_task(&task_id, transfer_token);
        let _ = command_sender.send(ConnectionCommand::ScheduleDownloads);
    });
}

pub(super) fn spawn_file_upload(
    stream: TcpStream,
    ticket: UploadTicket,
    uploads: UploadHub,
    local_shares: LocalSharesHub,
    people: PeopleHub,
    command_sender: mpsc::UnboundedSender<ConnectionCommand>,
) {
    let file = local_shares.resolve_file(&ticket.remote_filename);
    if people.is_blocked(&ticket.username) || file.is_none() {
        uploads.fail_attempt(
            &ticket.id,
            ticket.transfer_token,
            "File is no longer shared or this user is blocked.".into(),
        );
        let _ = command_sender.send(ConnectionCommand::ScheduleUploads);
        return;
    }
    let plan = match uploads.begin_file(&ticket.id, ticket.transfer_token, file.unwrap()) {
        Ok(plan) => plan,
        Err(error) => {
            uploads.fail_attempt(&ticket.id, ticket.transfer_token, error.to_string());
            let _ = command_sender.send(ConnectionCommand::ScheduleUploads);
            return;
        }
    };
    let cancellation = Arc::new(AtomicBool::new(false));
    if !uploads.register_task(plan.id.clone(), plan.transfer_token, cancellation.clone()) {
        return;
    }
    let task_uploads = uploads.clone();
    tauri::async_runtime::spawn(async move {
        let result = send_file(stream, &plan, cancellation.clone(), |transferred, speed| {
            task_uploads.update_progress(&plan.id, plan.transfer_token, transferred, speed);
        })
        .await;
        match result {
            Ok(Some(measurement)) => {
                if !cancellation.load(Ordering::SeqCst)
                    && task_uploads.complete(&plan.id, plan.transfer_token)
                {
                    if let Some(bytes_per_second) = measurement.average_speed() {
                        // This sender belongs to the originating server session. Never
                        // replay a completed upload against a different login/session.
                        let _ = command_sender
                            .send(ConnectionCommand::ReportUploadSpeed { bytes_per_second });
                    }
                }
            }
            Ok(None) => {}
            Err(message) => {
                task_uploads.fail_attempt(&plan.id, plan.transfer_token, message);
            }
        }
        task_uploads.unregister_task(&plan.id, plan.transfer_token);
        let _ = command_sender.send(ConnectionCommand::ScheduleUploads);
    });
}

#[derive(Debug)]
pub(super) struct UploadMeasurement {
    pub(super) bytes_sent: u64,
    pub(super) elapsed: Duration,
}

impl UploadMeasurement {
    pub(super) fn average_speed(&self) -> Option<u32> {
        if self.bytes_sent == 0 || self.elapsed.is_zero() {
            return None;
        }
        let speed = u128::from(self.bytes_sent) * 1_000_000_000 / self.elapsed.as_nanos();
        Some(speed.clamp(1, u128::from(u32::MAX)) as u32)
    }
}

pub(super) async fn send_file<S: AsyncRead + AsyncWrite + Unpin>(
    stream: S,
    plan: &UploadTicket,
    cancellation: Arc<AtomicBool>,
    progress: impl FnMut(u64, u64),
) -> Result<Option<UploadMeasurement>, String> {
    tokio::select! {
        biased;
        _ = async {
            while !cancellation.load(Ordering::SeqCst) {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        } => Ok(None),
        result = send_file_contents(stream, plan, progress) => result.map(Some),
    }
}

pub(super) async fn send_file_contents<S: AsyncRead + AsyncWrite + Unpin>(
    mut stream: S,
    plan: &UploadTicket,
    mut progress: impl FnMut(u64, u64),
) -> Result<UploadMeasurement, String> {
    let offset = timeout(PEER_MESSAGE_TIMEOUT, stream.read_u64_le())
        .await
        .map_err(|_| "The downloader did not send a resume offset in time.".to_owned())?
        .map_err(|error| format!("The upload resume offset could not be read: {error}"))?;
    if offset > plan.size_bytes {
        return Err("The downloader requested an invalid resume offset.".to_owned());
    }
    let mut file = File::open(&plan.local_path)
        .await
        .map_err(|error| format!("Forever could not open the shared file: {error}"))?;
    file.seek(SeekFrom::Start(offset))
        .await
        .map_err(|error| format!("Forever could not seek the shared file: {error}"))?;

    let mut transferred = offset;
    let mut last_bytes = transferred;
    let started = Instant::now();
    let mut last_update = started;
    let mut buffer = vec![0_u8; FILE_BUFFER_SIZE];
    while transferred < plan.size_bytes {
        let remaining = plan.size_bytes - transferred;
        let capacity = usize::try_from(remaining.min(FILE_BUFFER_SIZE as u64))
            .expect("bounded file read size fits usize");
        let count = file
            .read(&mut buffer[..capacity])
            .await
            .map_err(|error| format!("Forever could not read the shared file: {error}"))?;
        if count == 0 {
            return Err("The shared file ended before its indexed size.".to_owned());
        }
        stream
            .write_all(&buffer[..count])
            .await
            .map_err(|error| format!("The downloader connection was interrupted: {error}"))?;
        transferred += count as u64;
        let elapsed = last_update.elapsed();
        if elapsed >= Duration::from_millis(250) || transferred == plan.size_bytes {
            let millis = elapsed.as_millis().max(1) as u64;
            let speed = transferred.saturating_sub(last_bytes).saturating_mul(1_000) / millis;
            progress(transferred, speed);
            last_bytes = transferred;
            last_update = Instant::now();
        }
    }
    stream
        .flush()
        .await
        .map_err(|error| format!("The upload could not be finished: {error}"))?;
    // The downloader closes the F connection to signal receipt of the entire
    // file. Flushing alone only confirms writes to the local socket buffer.
    let mut acknowledgement = [0_u8; 1];
    let count = timeout(Duration::from_secs(30), stream.read(&mut acknowledgement))
        .await
        .map_err(|_| "The downloader did not close the completed upload in time.".to_owned())?
        .map_err(|error| format!("The downloader did not confirm the upload: {error}"))?;
    if count != 0 {
        return Err("The downloader sent unexpected data after the resume offset.".to_owned());
    }
    Ok(UploadMeasurement {
        bytes_sent: transferred - offset,
        elapsed: started.elapsed(),
    })
}

pub(super) async fn receive_file(
    mut stream: TcpStream,
    plan: &DownloadPlan,
    transfers: TransferHub,
    cancellation: Arc<AtomicBool>,
) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&plan.partial_path)
        .await
        .map_err(|error| format!("Forever could not open the partial file: {error}"))?;
    stream
        .write_u64_le(plan.offset)
        .await
        .map_err(|error| format!("The resume offset could not be sent: {error}"))?;
    stream
        .flush()
        .await
        .map_err(|error| format!("The source connection could not be started: {error}"))?;

    let mut transferred = plan.offset;
    let mut last_bytes = transferred;
    let mut last_update = Instant::now();
    let mut last_data = Instant::now();
    let mut buffer = vec![0_u8; FILE_BUFFER_SIZE];
    while transferred < plan.size_bytes {
        if cancellation.load(Ordering::SeqCst) {
            file.flush()
                .await
                .map_err(|error| format!("Forever could not flush the paused file: {error}"))?;
            file.sync_data()
                .await
                .map_err(|error| format!("Forever could not secure the paused file: {error}"))?;
            return Ok(());
        }
        let remaining = plan.size_bytes - transferred;
        let capacity = usize::try_from(remaining.min(FILE_BUFFER_SIZE as u64))
            .expect("bounded file read size fits usize");
        let count = tokio::select! {
            result = stream.read(&mut buffer[..capacity]) => result
                .map_err(|error| format!("The source connection was interrupted: {error}"))?,
            _ = tokio::time::sleep(Duration::from_millis(100)) => {
                if last_data.elapsed() >= Duration::from_secs(60) {
                    return Err("The source connection timed out without sending data.".into());
                }
                if last_update.elapsed() >= Duration::from_millis(250) {
                    let speed = transferred.saturating_sub(last_bytes).saturating_mul(1_000) / last_update.elapsed().as_millis().max(1) as u64;
                    transfers.update_progress(&plan.id, plan.transfer_token, transferred, speed);
                    last_bytes = transferred;
                    last_update = Instant::now();
                }
                continue;
            },
        };
        if count == 0 {
            return Err("The source closed the connection before the file completed.".to_owned());
        }
        last_data = Instant::now();
        if cancellation.load(Ordering::SeqCst) {
            continue;
        }
        file.write_all(&buffer[..count])
            .await
            .map_err(|error| format!("Forever could not write the partial file: {error}"))?;
        transferred += count as u64;
        let elapsed = last_update.elapsed();
        if elapsed >= Duration::from_millis(250) || transferred == plan.size_bytes {
            let millis = elapsed.as_millis().max(1) as u64;
            let speed = transferred.saturating_sub(last_bytes).saturating_mul(1_000) / millis;
            transfers.update_progress(&plan.id, plan.transfer_token, transferred, speed);
            last_bytes = transferred;
            last_update = Instant::now();
        }
    }
    if cancellation.load(Ordering::SeqCst) {
        return Ok(());
    }
    file.flush()
        .await
        .map_err(|error| format!("Forever could not finish the partial file: {error}"))?;
    file.sync_all()
        .await
        .map_err(|error| format!("Forever could not secure the completed file: {error}"))?;
    drop(file);

    let plan = plan.clone();
    tokio::task::spawn_blocking(move || transfers.complete(&plan))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(super) fn peer_timeout_error() -> ProtocolError {
    ProtocolError::Io(std::io::Error::new(
        std::io::ErrorKind::TimedOut,
        "Soulseek peer timed out",
    ))
}

pub(super) fn retryable_download_error(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    normalized.contains("source connection was interrupted")
        || normalized.contains("source closed the connection")
        || normalized.contains("timed out")
}
