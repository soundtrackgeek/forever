export type SearchResult = {
  id: string;
  title: string;
  subtitle: string;
  owner: string;
  trust: number;
  format: string;
  quality: string;
  size: string;
  tracks: number;
  rating: number;
  ratingLabel: string;
  availability: number[];
  source?: "preview" | "live";
  year?: number;
  filename?: string;
  folder?: string;
  sizeBytes?: number;
  bitrate?: number | null;
  durationSeconds?: number | null;
  vbr?: boolean | null;
  sampleRate?: number | null;
  bitDepth?: number | null;
  slotFree?: boolean;
  averageSpeed?: number;
  queueLength?: number;
  isPrivate?: boolean;
};

export type AlbumSearchContext = {
  albumId: string;
  artist: string;
  title: string;
  coverArtUrl: string;
  firstReleaseDate: string;
};

export type AlbumSource = {
  id: string;
  owner: string;
  folder: string;
  folderName: string;
  files: SearchResult[];
  tracks: SearchResult[];
  formats: string[];
  qualities: string[];
  totalSizeBytes: number;
  slotFree: boolean;
  averageSpeed: number;
  queueLength: number;
  isPrivate: boolean;
  representative: SearchResult;
};

export type WantedFormatPreference = "any" | "preferLossless" | "losslessOnly";

export type WantedPreferences = {
  formatPreference: WantedFormatPreference;
  minimumBitrateKbps: 128 | 192 | 256 | 320 | null;
  minimumTrackCount: number | null;
};

export type WantedBestSource = {
  username: string;
  folder: string;
  format: string;
  trackCount: number;
  sizeBytes: number;
  slotFree: boolean;
  averageSpeedBytesPerSecond: number;
  queueLength: number;
  minimumBitrateKbps: number | null;
  score: number;
};

export type WantedAlbum = {
  albumId: string;
  artist: string;
  title: string;
  firstReleaseDate: string;
  coverArtUrl: string | null;
  paused: boolean;
  fulfilled: boolean;
  fulfilledAtMs: number | null;
  ownedTrackCount: number | null;
  preferences: WantedPreferences;
  addedAtMs: number;
  lastCheckedAtMs: number | null;
  sourceCount: number;
  matchingSourceCount: number;
  readySourceCount: number;
  completeSourceCount: number;
  newSourceCount: number;
  bestFormat: string | null;
  bestTrackCount: number | null;
  bestSizeBytes: number | null;
  bestSpeedBytesPerSecond: number | null;
  bestSource: WantedBestSource | null;
  error: string | null;
};

export type WantedSnapshot = {
  albums: WantedAlbum[];
  intervalMinutes: 0 | 15 | 30 | 60;
  activeAlbumId: string | null;
  nextCheckAtMs: number | null;
  updatedAtMs: number;
};

export type PersonStatus = "unknown" | "offline" | "away" | "online";

export type ProfileState =
  | "idle"
  | "loading"
  | "ready"
  | "unavailable"
  | "error";

export type PersonProfile = {
  username: string;
  status: PersonStatus;
  profileState: ProfileState;
  countryCode: string | null;
  description: string | null;
  pictureDataUrl: string | null;
  averageSpeed: number;
  uploadCount: number;
  sharedFileCount: number;
  sharedDirectoryCount: number;
  uploadSlots: number | null;
  queueSize: number | null;
  slotsFree: boolean | null;
  uploadPermission: number | null;
  likes: string[];
  hates: string[];
  privileged: boolean;
  favorite: boolean;
  blocked: boolean;
  ignored?: boolean;
  error: string | null;
  lastSeenAtMs: number | null;
  lastInteractionAtMs: number;
  updatedAtMs: number;
};

export type PeopleSnapshot = {
  users: PersonProfile[];
  favoriteCount: number;
  onlineFavoriteCount: number;
  updatedAtMs: number;
};

export type MessageDirection = "incoming" | "outgoing";
export type MessageDelivery = "received" | "queued" | "sent" | "failed";

export type PrivateMessage = {
  id: string;
  serverId: number | null;
  username: string;
  body: string;
  direction: MessageDirection;
  sentAtMs: number;
  unread: boolean;
  delivery: MessageDelivery;
  error: string | null;
};

export type PrivateConversation = {
  username: string;
  messages: PrivateMessage[];
  unreadCount: number;
  updatedAtMs: number;
};

export type MessagesSnapshot = {
  conversations: PrivateConversation[];
  unreadCount: number;
  updatedAtMs: number;
};

export type SearchState =
  | "idle"
  | "searching"
  | "completed"
  | "stopped"
  | "error";

export type SearchSnapshot = {
  state: SearchState;
  token: number | null;
  query: string;
  resultCount: number;
  peerCount: number;
  message: string;
  startedAtMs: number | null;
  finishedAtMs: number | null;
};

export type LiveSearchResult = {
  id: string;
  token: number;
  username: string;
  filename: string;
  sizeBytes: number;
  extension: string;
  bitrate: number | null;
  durationSeconds: number | null;
  vbr: boolean | null;
  sampleRate: number | null;
  bitDepth: number | null;
  slotFree: boolean;
  averageSpeed: number;
  queueLength: number;
  isPrivate: boolean;
};

export type SearchEvent = {
  event: "started" | "results" | "completed" | "stopped" | "error";
  snapshot: SearchSnapshot;
  results: LiveSearchResult[];
};

export type RadarState = "idle" | "scanning" | "completed" | "stopped" | "error";
export type RadarAlbumState = "queued" | "scanning" | "completed" | "stopped" | "error";

export type RadarAlbumRequest = {
  albumId: string;
  artist: string;
  title: string;
  firstReleaseDate: string;
  coverArtUrl: string | null;
};

export type RadarAlbumScan = RadarAlbumRequest & {
  state: RadarAlbumState;
  resultCount: number;
  peerCount: number;
  startedAtMs: number | null;
  finishedAtMs: number | null;
  error: string | null;
};

export type RadarSnapshot = {
  state: RadarState;
  albums: RadarAlbumScan[];
  activeAlbumId: string | null;
  completedCount: number;
  totalCount: number;
  message: string;
  updatedAtMs: number;
};

export type RadarEvent = {
  event: "started" | "albumStarted" | "results" | "albumCompleted" | "stopped" | "error";
  snapshot: RadarSnapshot;
  albumId: string | null;
  results: LiveSearchResult[];
};

export type Track = {
  id: number;
  title: string;
  duration: string;
};

export type Transfer = {
  id: string;
  releaseId?: string | null;
  releaseTitle?: string | null;
  releaseFolder?: string | null;
  fileIndex?: number | null;
  fileCount?: number | null;
  title: string;
  username: string;
  remoteFilename: string;
  sizeBytes: number;
  transferredBytes: number;
  speedBytesPerSecond: number;
  etaSeconds: number | null;
  status:
    | "queued"
    | "retrying"
    | "requesting"
    | "remotelyQueued"
    | "connecting"
    | "downloading"
    | "paused"
    | "completed"
    | "failed";
  queuePosition: number | null;
  localPath: string;
  error: string | null;
  retryCount?: number;
  retryAtMs?: number | null;
  verificationStatus?: "pending" | "verified" | "missing" | "sizeMismatch";
  verificationMessage?: string | null;
  verifiedAtMs?: number | null;
  alternativeSources?: ReleaseAlternativeSource[];
  createdAtMs: number;
  updatedAtMs: number;
};

export type ReleaseAlternativeFile = {
  title: string;
  remoteFilename: string;
  sizeBytes: number;
};

export type ReleaseAlternativeSource = {
  username: string;
  remoteFolder: string;
  files: ReleaseAlternativeFile[];
};

export type FolderFile = {
  remoteFilename: string;
  directory: string;
  filename: string;
  sizeBytes: number;
  extension: string;
  bitrate: number | null;
  durationSeconds: number | null;
  vbr: boolean | null;
  sampleRate: number | null;
  bitDepth: number | null;
};

export type FolderInspection = {
  token: number;
  username: string;
  requestedFolder: string;
  files: FolderFile[];
  receivedAtMs: number;
};

export type ShareDirectorySummary = {
  path: string;
  name: string;
  parent: string | null;
  depth: number;
  fileCount: number;
  totalSizeBytes: number;
  isPrivate: boolean;
};

export type UserSharesOverview = {
  username: string;
  directories: ShareDirectorySummary[];
  totalFileCount: number;
  totalSizeBytes: number;
  publicDirectoryCount: number;
  privateDirectoryCount: number;
  receivedAtMs: number;
};

export type ShareFile = FolderFile & {
  isPrivate: boolean;
};

export type ShareFolderSnapshot = {
  username: string;
  directory: string;
  isPrivate: boolean;
  files: ShareFile[];
  totalSizeBytes: number;
};

export type ShareSearchSnapshot = {
  username: string;
  query: string;
  extension: string | null;
  directories: ShareDirectorySummary[];
  files: ShareFile[];
  truncated: boolean;
};

export type AlbumArtist = {
  id: string;
  name: string;
  disambiguation: string | null;
  country: string | null;
  artistType: string | null;
  score: number;
};

export type AlbumReleaseGroup = {
  id: string;
  title: string;
  firstReleaseDate: string;
  primaryType: string | null;
  secondaryTypes: string[];
  coverArtUrl: string;
};

export type AlbumCatalog = {
  artistId: string;
  albums: AlbumReleaseGroup[];
  truncated: boolean;
};

export type ArchiveStatus = {
  path: string;
  connected: boolean;
  readOnly: boolean;
  albumCount: number | null;
  trackCount: number | null;
  lastImportedAt: string | null;
  lastModifiedAtMs: number | null;
  error: string | null;
};

export type ArchiveOwnership = "owned" | "notOwned" | "unknown";

export type ArchiveAlbumMatch = {
  albumId: string;
  ownership: ArchiveOwnership;
  localAlbumId: string | null;
  localTitle: string | null;
  localArtist: string | null;
  localYear: number | null;
  trackCount: number | null;
};

export type ArchiveMatchResponse = {
  source: ArchiveStatus;
  matches: ArchiveAlbumMatch[];
};

export type ArchiveArtistSummary = {
  name: string;
  ownedAlbumCount: number;
  firstYear: number | null;
  lastYear: number | null;
  artistId: string | null;
  canonicalName: string | null;
  cachedReleaseCount: number;
  catalogFetchedAt: string | null;
};

export type ArchiveArtistsResponse = {
  source: ArchiveStatus;
  artists: ArchiveArtistSummary[];
  truncated: boolean;
};

export type ArchiveCachedCatalog = {
  catalog: AlbumCatalog;
  fetchedAt: string | null;
};

export type TransferQueueSnapshot = {
  transfers: Transfer[];
  activeCount: number;
};

export type SharedRoot = {
  id: string;
  path: string;
  alias: string;
  enabled: boolean;
  fileCount: number;
  directoryCount: number;
  totalSizeBytes: number;
  error: string | null;
};

export type LocalSharesSnapshot = {
  roots: SharedRoot[];
  uploadSlots: number;
  scanning: boolean;
  totalFileCount: number;
  totalDirectoryCount: number;
  totalSizeBytes: number;
  lastScanAtMs: number | null;
};

export type Upload = {
  id: string;
  username: string;
  remoteFilename: string;
  filename: string;
  sizeBytes: number;
  transferredBytes: number;
  speedBytesPerSecond: number;
  etaSeconds: number | null;
  status: "queued" | "connecting" | "uploading" | "completed" | "failed" | "cancelled";
  queuePosition: number | null;
  error: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type UploadQueueSnapshot = {
  uploads: Upload[];
  activeCount: number;
  queuedCount: number;
  sessionUploadedBytes: number;
};

export type ConnectionState =
  | "unconfigured"
  | "offline"
  | "connecting"
  | "authenticating"
  | "online"
  | "reconnecting"
  | "error";

export type ConnectionProfile = {
  username: string;
  serverHost: string;
  serverPort: number;
  downloadDirectory: string;
  rememberPassword: boolean;
  autoConnect: boolean;
};

export type ConnectionSnapshot = {
  state: ConnectionState;
  username: string | null;
  server: string | null;
  message: string;
  attempt: number;
  connectedAtMs: number | null;
  retryInSeconds: number | null;
  updatedAtMs: number;
};

export type DistributedState =
  | "offline"
  | "discovering"
  | "connected"
  | "branchRoot";

export type DistributedSnapshot = {
  state: DistributedState;
  message: string;
  branchLevel: number | null;
  searchesReceived: number;
  searchesMatched: number;
  searchesAnswered: number;
  searchesIgnored: number;
  updatedAtMs: number;
};

export type DiagnosticEntry = {
  timestampMs: number;
  level: string;
  event: string;
  message: string;
};

export type ConnectionBootstrap = {
  profile: ConnectionProfile | null;
  suggestedProfile: ConnectionProfile;
  hasPassword: boolean;
  snapshot: ConnectionSnapshot;
  searchNetwork: DistributedSnapshot;
  diagnosticsPath: string;
  diagnostics: DiagnosticEntry[];
};
