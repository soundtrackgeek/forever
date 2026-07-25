export type SearchResult = {
  id: string;
  title: string;
  subtitle: string;
  year: number;
  owner: string;
  trust: number;
  format: "FLAC" | "MP3";
  quality: string;
  size: string;
  tracks: number;
  rating: number;
  ratingLabel: string;
  availability: number[];
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
