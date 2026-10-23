import { useState } from "react";
import type { StoreNotice } from "../types";

export function StorageNotices({ notices }: { notices: StoreNotice[] }) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const visible = notices.filter((notice) => !dismissed.includes(`${notice.store}:${notice.message}`));
  const storeCount = new Set(visible.map((notice) => notice.store)).size;
  if (visible.length === 0) return null;

  return (
    <aside className="storage-notices" role="status" aria-label="Saved data notice">
      <div className="storage-notices-heading">
        <strong>Some saved data needs attention</strong>
        <button type="button" onClick={() => setDismissed(notices.map((notice) => `${notice.store}:${notice.message}`))}>
          Dismiss
        </button>
      </div>
      <details>
        <summary>View recovery details ({storeCount} {storeCount === 1 ? "store" : "stores"})</summary>
        <ul>{visible.map((notice) => (
          <li key={`${notice.store}:${notice.message}`}><strong>{notice.store}</strong> — {notice.message}</li>
        ))}</ul>
      </details>
    </aside>
  );
}
