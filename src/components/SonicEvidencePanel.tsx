import { useEffect, useRef, useState } from "react";
import type { SonicEvidence } from "../types";

const sonicVerdictLabels: Record<SonicEvidence["verdict"], string> = {
  likelyGenuine: "Likely genuine",
  suspectTranscode: "Suspect transcode",
  likelyUpsampled: "Likely upsampled",
  inconclusive: "Inconclusive",
  lossySource: "Lossy source",
};

function Spectrogram({ evidence, title }: { evidence: SonicEvidence; title: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (!context) return;
    context.fillStyle = "#101522";
    context.fillRect(0, 0, 768, 192);
    let cells: string;
    try { cells = atob(evidence.spectrogram.slice(0, 8192)); } catch { return; }
    for (let x = 0; x < cells.length / 64; x += 1) {
      const left = x * evidence.columnSeconds / evidence.analyzedSeconds * 768;
      const width = Math.min(768 - left, evidence.columnSeconds / evidence.analyzedSeconds * 768);
      for (let y = 0; y < 64; y += 1) {
        const level = cells.charCodeAt(x * 64 + y);
        const strength = Math.max(0, Math.min(96, level)) / 96;
        context.fillStyle = `hsl(${265 - strength * 95} 65% ${5 + strength * 66}%)`;
        context.fillRect(left, 192 - (y + 1) * 3, Math.ceil(width), 3);
      }
    }
  }, [evidence]);
  return <figure className="sonic-spectrogram">
    <div className="sonic-frequency-axis"><span>{(evidence.sampleRate / 2000).toFixed(1)} kHz</span><span>0 kHz</span></div>
    <canvas ref={ref} width={768} height={192} role="img" aria-label={`Spectrogram of ${title}: time left to right, frequency bottom to top`} />
    <figcaption><span>0:00 → {Math.floor(evidence.analyzedSeconds / 60)}:{String(Math.floor(evidence.analyzedSeconds % 60)).padStart(2, "0")}</span><span>Relative power · dark −96 dB → bright 0 dB</span></figcaption>
  </figure>;
}

export function SonicEvidencePanel({ evidence, title }: { evidence?: SonicEvidence | null; title: string }) {
  const [open, setOpen] = useState(false);
  if (!evidence) return <p className="sonic-pending">Sonic evidence not measured. Run Deep scan.</p>;
  return <details className="sonic-evidence" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{sonicVerdictLabels[evidence.verdict]} · Sonic evidence{evidence.paddedBitDepth ? " · Padded bit depth" : ""}{evidence.clippingRuns ? " · Possible clipping" : ""}</summary>
    {open ? <div className="sonic-evidence-body">
      <p>{evidence.cutoffHz
        ? `${(evidence.cutoffHz / 1000).toFixed(1)} kHz shelf in ${Math.round(evidence.cutoffConsistency * 100)}% of active windows · energy above shelf ${evidence.energyAboveCutoffDb?.toFixed(1) ?? "—"} dB relative to total.`
        : evidence.verdict === "inconclusive" ? "Too little broadband evidence to judge the source reliably." : evidence.verdict === "lossySource" ? "This stream already uses a lossy codec; its cutoff is not evidence of disguised lossless audio." : "Broadband content found; no consistent shelf detected."}</p>
      <p>{evidence.activeWindows}/{evidence.windows} active spectral windows · {evidence.clippedSamples.toLocaleString()} full-scale samples · {evidence.clippingRuns} clipping runs{evidence.paddedBitDepth ? " · Integer samples use no precision beyond 16 bits" : ""}.</p>
      {evidence.spectrogram.length ? <Spectrogram evidence={evidence} title={title} /> : null}
      <p className="sonic-caveat">Advisory evidence, not proof of origin or an exact MP3 bitrate. Older or filtered masters can have the same shelves. No detected issue does not guarantee a genuine source. Files are read only.</p>
    </div> : null}
  </details>;
}
