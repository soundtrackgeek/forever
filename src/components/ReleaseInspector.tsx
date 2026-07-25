import {
  ArrowLeft,
  DotsThree,
  DownloadSimple,
  FileAudio,
  Plus,
  PushPin,
  ShieldCheck,
  Waves,
} from "@phosphor-icons/react";
import { tracks } from "../data/mockData";
import type { SearchResult } from "../types";

type ReleaseInspectorProps = {
  result: SearchResult | null;
  onQueueDownload: (result: SearchResult) => void;
};

const fileAvailability = [
  18, 9, 22, 14, 28, 34, 17, 24, 31, 21, 38, 27, 42, 19, 33, 26, 37, 29,
  22, 34, 31, 25, 36, 27,
];

const speedLabel = (bytesPerSecond?: number) => {
  if (!bytesPerSecond) return "Not reported";
  const megabytes = bytesPerSecond / 1_000_000;
  return `${megabytes >= 10 ? megabytes.toFixed(0) : megabytes.toFixed(1)} MB/s`;
};

export function ReleaseInspector({
  result,
  onQueueDownload,
}: ReleaseInspectorProps) {
  const live = result?.source === "live";

  return (
    <aside className="release-inspector" aria-label="Selected result">
      <header className="inspector-header">
        <span>
          <ArrowLeft size={15} /> {live ? "Selected file" : "Selected release"}
        </span>
        <span className="inspector-header-actions">
          <button type="button" aria-label="Pin result" title="Pin">
            <PushPin size={15} />
          </button>
          <button type="button" aria-label="More result actions" title="More">
            <DotsThree size={19} weight="bold" />
          </button>
        </span>
      </header>

      {!result ? (
        <div className="inspector-empty">
          <Waves size={30} weight="light" />
          <h2>Waiting for a signal</h2>
          <p>Select a result to inspect its file and source details.</p>
        </div>
      ) : live ? (
        <>
          <div className="inspector-scroll live-file-inspector">
            <div className="live-file-art">
              <FileAudio size={54} weight="thin" />
              <span>{result.format}</span>
            </div>
            <div className="inspector-release-copy">
              <h2>{result.title}</h2>
              <p>{result.folder}</p>
              <div className="format-row">
                <span>{result.format}</span>
                <span className="is-amber">{result.quality}</span>
                {result.vbr && <span>VBR</span>}
              </div>
            </div>

            <section className="file-facts">
              <span>
                <small>File size</small>
                <strong>{result.size}</strong>
              </span>
              <span>
                <small>Source speed</small>
                <strong>{speedLabel(result.averageSpeed)}</strong>
              </span>
              <span>
                <small>Queue</small>
                <strong>
                  {result.slotFree ? "Slot ready" : `${result.queueLength ?? 0} waiting`}
                </strong>
              </span>
              <span>
                <small>Visibility</small>
                <strong>{result.isPrivate ? "Private share" : "Public share"}</strong>
              </span>
            </section>

            <section className="source-profile">
              <span className="source-avatar">{result.owner.slice(0, 1).toUpperCase()}</span>
              <span>
                <strong>{result.owner}</strong>
                <small>
                  <ShieldCheck size={11} weight="fill" aria-hidden="true" />{" "}
                  Live Soulseek response
                </small>
                <small>
                  <i aria-hidden="true" /> Online now
                </small>
              </span>
            </section>
          </div>
          <footer className="inspector-actions live-download-note">
            <button
              type="button"
              className="primary-action"
              onClick={() => onQueueDownload(result)}
            >
              <DownloadSimple size={18} weight="bold" /> Download file
            </button>
          </footer>
        </>
      ) : (
        <>
          <div className="inspector-scroll">
            <img
              className="inspector-art"
              src="/assets/night-geometry-cover.png"
              alt="Night Geometry cover: a violet moon behind a dark monolith"
            />

            <div className="inspector-release-copy">
              <h2>{result.title.replace(/ \(.*\)/, "")}</h2>
              <p>Liminal Structures</p>
              <small>
                {result.year}&nbsp;&nbsp;•&nbsp;&nbsp;{result.tracks} tracks
                &nbsp;&nbsp;•&nbsp;&nbsp;53:21
              </small>
              <div className="format-row">
                <span>{result.format}</span>
                <span className="is-amber">{result.quality}</span>
                <span>VINYL RIP</span>
              </div>
            </div>

            <ol className="track-list">
              {tracks.map((track, index) => (
                <li className={index === 0 ? "is-active" : ""} key={track.id}>
                  <span className="track-index">
                    {index === 0 && <i aria-hidden="true" />}
                    {track.id}
                  </span>
                  <strong>{track.title}</strong>
                  <time>{track.duration}</time>
                </li>
              ))}
            </ol>

            <section className="file-availability">
              <span>File availability</span>
              <div aria-label="All files available">
                {fileAvailability.map((value, index) => (
                  <i key={`${value}-${index}`} style={{ height: `${value}%` }} />
                ))}
              </div>
              <strong>10 of 10 files available</strong>
            </section>

            <section className="source-profile">
              <img src="/assets/listener-avatar.png" alt="" />
              <span>
                <strong>{result.owner}</strong>
                <small>
                  <ShieldCheck size={11} weight="fill" aria-hidden="true" />{" "}
                  {result.trust}% &nbsp;•&nbsp; 2,341 shares
                </small>
                <small>
                  <i aria-hidden="true" /> Online &nbsp;•&nbsp; Last seen just now
                </small>
              </span>
            </section>
          </div>

          <footer className="inspector-actions">
            <button
              type="button"
              className="primary-action"
              onClick={() => onQueueDownload(result)}
            >
              <DownloadSimple size={18} weight="bold" /> Get files
            </button>
            <button
              type="button"
              className="secondary-action"
              aria-label="Add to queue"
              onClick={() => onQueueDownload(result)}
            >
              <Plus size={19} />
            </button>
            <button
              type="button"
              className="secondary-action"
              aria-label="More actions"
            >
              <DotsThree size={20} weight="bold" />
            </button>
          </footer>
        </>
      )}
    </aside>
  );
}
