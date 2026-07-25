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

export type Track = {
  id: number;
  title: string;
  duration: string;
};

export type Transfer = {
  id: string;
  release: string;
  track: string;
  progress: number;
  transferred: string;
  total: string;
  speed: string;
  eta: string;
  status: "downloading" | "queued" | "paused";
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
  diagnosticsPath: string;
  diagnostics: DiagnosticEntry[];
};
