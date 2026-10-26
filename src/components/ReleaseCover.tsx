import { DownloadSimple } from "@phosphor-icons/react";
import { useState } from "react";
import { useReleaseCover } from "../hooks/useReleaseCover";
import type { TransferGroup } from "../utils/transfers";

/** Album art for a transfer group, with the placeholder tile when none can be found. */
export function ReleaseCover({ group, size = 24 }: { group: TransferGroup; size?: number }) {
  const url = useReleaseCover(group);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (url && failedUrl !== url) {
    return <img src={url} alt="" loading="lazy" onError={() => setFailedUrl(url)} />;
  }
  return <span className="release-cover-placeholder"><DownloadSimple size={size} weight="thin" /></span>;
}
