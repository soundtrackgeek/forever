import { ChartBar } from "@phosphor-icons/react";
import { useStatistics } from "../hooks/useStatistics";
import {
  cumulativeFulfilled,
  deriveInsights,
  formatDuration,
  formatStatBytes,
  formatStatSpeed,
  percent,
  type StatDay,
} from "../utils/statistics";

const CHART_WIDTH = 600;
const CHART_HEIGHT = 120;

const shortDay = (day: string) => {
  const date = new Date(`${day}T00:00:00`);
  return Number.isNaN(date.getTime()) ? day : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

function TransferChart({ daily }: { daily: StatDay[] }) {
  const peak = Math.max(1, ...daily.map((day) => Math.max(day.downBytes, day.upBytes)));
  const slot = CHART_WIDTH / Math.max(1, daily.length);
  const bar = Math.max(1, slot / 2 - 1.5);
  const height = (bytes: number) => (bytes > 0 ? Math.max(2, (bytes / peak) * (CHART_HEIGHT - 4)) : 0);
  const totalDown = daily.reduce((total, day) => total + day.downBytes, 0);
  const totalUp = daily.reduce((total, day) => total + day.upBytes, 0);
  return (
    <figure className="statistics-chart">
      <figcaption>
        <strong>Traffic, last {daily.length} days</strong>
        <span><i className="is-down" /> Received {formatStatBytes(totalDown)}</span>
        <span><i className="is-up" /> Shared {formatStatBytes(totalUp)}</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-label={`Daily received and shared bytes for the last ${daily.length} days. Received ${formatStatBytes(totalDown)}, shared ${formatStatBytes(totalUp)}.`}
        preserveAspectRatio="none"
      >
        <line x1="0" x2={CHART_WIDTH} y1={CHART_HEIGHT - 0.5} y2={CHART_HEIGHT - 0.5} className="statistics-axis" />
        {daily.map((day, index) => {
          const x = index * slot + 1;
          const down = height(day.downBytes);
          const up = height(day.upBytes);
          return (
            <g key={day.day}>
              <title>{`${shortDay(day.day)}: received ${formatStatBytes(day.downBytes)}, shared ${formatStatBytes(day.upBytes)}`}</title>
              <rect className="is-down" x={x} y={CHART_HEIGHT - down} width={bar} height={down} rx="1" />
              <rect className="is-up" x={x + bar + 1} y={CHART_HEIGHT - up} width={bar} height={up} rx="1" />
            </g>
          );
        })}
      </svg>
      <div className="statistics-chart-axis" aria-hidden="true">
        <span>{daily[0] ? shortDay(daily[0].day) : ""}</span>
        <span>{daily.length ? shortDay(daily[daily.length - 1].day) : ""}</span>
      </div>
    </figure>
  );
}

function CollectionChart({ daily }: { daily: StatDay[] }) {
  const points = cumulativeFulfilled(daily);
  const total = points.length ? points[points.length - 1].value : 0;
  const top = Math.max(1, total);
  const step = CHART_WIDTH / Math.max(1, points.length - 1);
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${(index * step).toFixed(1)} ${(CHART_HEIGHT - 4 - (point.value / top) * (CHART_HEIGHT - 12)).toFixed(1)}`)
    .join(" ");
  return (
    <figure className="statistics-chart">
      <figcaption>
        <strong>Wanted albums found</strong>
        <span><i className="is-line" /> {total} in the last {points.length} days</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-label={`Running total of Wanted albums fulfilled over the last ${points.length} days: ${total}.`}
        preserveAspectRatio="none"
      >
        <line x1="0" x2={CHART_WIDTH} y1={CHART_HEIGHT - 0.5} y2={CHART_HEIGHT - 0.5} className="statistics-axis" />
        {path && <path d={path} className="statistics-line" />}
      </svg>
      <div className="statistics-chart-axis" aria-hidden="true">
        <span>{points[0] ? shortDay(points[0].day) : ""}</span>
        <span>{points.length ? shortDay(points[points.length - 1].day) : ""}</span>
      </div>
    </figure>
  );
}

type StatisticsPanelProps = {
  onOpenProfile?: (username: string) => void;
  onBrowseUser?: (username: string) => void;
};

export function StatisticsPanel({ onOpenProfile, onBrowseUser }: StatisticsPanelProps = {}) {
  const { snapshot, ready, error, preview } = useStatistics();
  const insights = deriveInsights(snapshot);
  const totals = snapshot.totals;
  const tiles: { label: string; value: string; note: string }[] = [
    { label: "Received", value: formatStatBytes(totals.downBytes), note: `${totals.downFiles} ${totals.downFiles === 1 ? "file" : "files"}` },
    { label: "Shared", value: formatStatBytes(totals.upBytes), note: `${totals.upFiles} ${totals.upFiles === 1 ? "file" : "files"}` },
    {
      label: "Share ratio",
      value: insights.shareRatio === null ? "—" : insights.shareRatio.toFixed(2),
      note: insights.shareRatio === null ? "Nothing received yet" : "shared per byte received",
    },
    { label: "Downloads finished", value: percent(insights.downloadSuccessRate), note: `${totals.downFailures} failed ${totals.downFailures === 1 ? "attempt" : "attempts"}` },
    { label: "Wanted hit rate", value: percent(insights.wantedHitRate), note: `${totals.wantedHits} of ${totals.wantedChecks} checks found sources` },
    {
      label: "Time to find",
      value: insights.averageTimeToFindMs === null ? "—" : formatDuration(insights.averageTimeToFindMs),
      note: insights.averageTimeToFindMs === null ? "No Wanted album received yet" : `average over ${totals.wantedFulfilled} ${totals.wantedFulfilled === 1 ? "album" : "albums"}`,
    },
    { label: "Soundcheck passed", value: percent(insights.soundcheckPassRate), note: `${insights.soundcheckTotal} ${insights.soundcheckTotal === 1 ? "file" : "files"} checked` },
    { label: "Direct connections", value: percent(insights.reachableShare), note: `${totals.reachableChecks} reachable, ${totals.blockedChecks} blocked` },
  ];
  return (
    <section className="listening-post-statistics" aria-label="Insights">
      <header>
        <h2><ChartBar size={16} /> Insights</h2>
        <small>
          {preview
            ? "Sample data in the browser preview"
            : snapshot.trackedSince
              ? `Counting since ${shortDay(snapshot.trackedSince)} · stays on this computer`
              : "Stays on this computer"}
        </small>
      </header>
      {error && <p className="statistics-error" role="alert">Statistics could not be read: {error}</p>}
      {!insights.hasActivity && ready && !error ? (
        <p className="statistics-empty">
          Insights fill in as you download, share and watch albums. Nothing has been counted yet.
        </p>
      ) : (
        <>
          <dl className="statistics-tiles">
            {tiles.map((tile) => (
              <div key={tile.label}>
                <dt>{tile.label}</dt>
                <dd>{tile.value}</dd>
                <small>{tile.note}</small>
              </div>
            ))}
          </dl>
          {snapshot.daily.length > 0 && (
            <div className="statistics-charts">
              <TransferChart daily={snapshot.daily} />
              <CollectionChart daily={snapshot.daily} />
            </div>
          )}
          <section className="statistics-sources" aria-label="Top sources">
            <h3>Top sources</h3>
            {snapshot.topSources.length ? (
              <ol>
                {snapshot.topSources.map((source) => (
                  <li key={source.username}>
                    {onOpenProfile ? (
                      <button
                        type="button"
                        className="statistics-source-name"
                        title={`View ${source.username}'s profile`}
                        onClick={() => onOpenProfile(source.username)}
                      >
                        {source.username}
                      </button>
                    ) : (
                      <strong>{source.username}</strong>
                    )}
                    <span>{formatStatBytes(source.bytes)} · {source.files} {source.files === 1 ? "file" : "files"}
                      {source.speedBytesPerSecond ? ` · ${formatStatSpeed(source.speedBytesPerSecond)}` : ""}
                    </span>
                    <span
                      className="statistics-reliability"
                      title={source.reliability === null ? undefined : `${source.files} finished, ${source.failures} failed attempts`}
                    >
                      {percent(source.reliability)} reliable
                    </span>
                    {onBrowseUser && (
                      <button
                        type="button"
                        className="statistics-source-browse"
                        aria-label={`Browse ${source.username}'s shares`}
                        onClick={() => onBrowseUser(source.username)}
                      >
                        Browse shares
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="statistics-empty">Sources appear after your first finished download.</p>
            )}
          </section>
        </>
      )}
    </section>
  );
}
