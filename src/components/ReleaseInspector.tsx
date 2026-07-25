import {
  ArrowLeft,
  DotsThree,
  DownloadSimple,
  Plus,
  PushPin,
  ShieldCheck,
} from "@phosphor-icons/react";
import { tracks } from "../data/mockData";
import type { SearchResult } from "../types";

type ReleaseInspectorProps = {
  result: SearchResult;
  onQueueDownload: (result: SearchResult) => void;
};

const fileAvailability = [
  18, 9, 22, 14, 28, 34, 17, 24, 31, 21, 38, 27, 42, 19, 33, 26, 37, 29,
  22, 34, 31, 25, 36, 27,
];

export function ReleaseInspector({
  result,
  onQueueDownload,
}: ReleaseInspectorProps) {
  return (
    <aside className="release-inspector" aria-label="Selected release">
      <header className="inspector-header">
        <span>
          <ArrowLeft size={15} /> Selected release
        </span>
        <span className="inspector-header-actions">
          <button type="button" aria-label="Pin release" title="Pin release">
            <PushPin size={15} />
          </button>
          <button type="button" aria-label="More release actions" title="More">
            <DotsThree size={19} weight="bold" />
          </button>
        </span>
      </header>

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
    </aside>
  );
}
