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
