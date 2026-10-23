import type { FolderInspection } from "../types";
import { albumFolder } from "./albumSources";

const normalized = (path: string) => path.replace(/\//g, "\\").replace(/\\+$/, "");
const key = (path: string) => normalized(path).toLowerCase();

// Some peers return descendants with the parent; others only answer each disc.
// Require every advertised disc, retain parent companions, and reject siblings.
export async function inspectAlbumSource(
  folder: string, folders: string[],
  inspect: (folder: string) => Promise<FolderInspection>,
): Promise<FolderInspection> {
  const root = normalized(folder);
  const children = [...new Set(folders.map(normalized))]
    .filter((path) => key(path) !== key(root) && key(albumFolder(path)) === key(root));
  if (!children.length) return inspect(root);
  if (children.length > 100) throw new Error("This album has too many disc folders to inspect.");
  const allowed = new Set([key(root), ...children.map(key)]);
  const files = new Map<string, FolderInspection["files"][number]>();
  let base: FolderInspection | null = null;
  const add = (response: FolderInspection) => {
    base ??= response;
    for (const file of response.files) {
      // Check the full filename as well as the peer's directory field.
      const path = normalized(file.remoteFilename);
      const parent = path.slice(0, path.lastIndexOf("\\"));
      if (allowed.has(key(parent)) && allowed.has(key(file.directory))) files.set(key(path), file);
    }
  };
  try { add(await inspect(root)); }
  catch (error) { if (!children.length || folders.some((f) => key(f) === key(root))) throw error; }
  for (const child of children) {
    // Always request each disc: a partial parent listing must not hide files.
    const response = await inspect(child);
    if (!response.files.some((f) => key(f.directory) === key(child))) {
      throw new Error("The source did not return the advertised disc folder: " + child);
    }
    add(response);
  }
  if (!base || files.size === 0) throw new Error("The album source returned no files.");
  return { ...(base as FolderInspection), requestedFolder: root,
    files: [...files.values()].sort((a, b) => a.remoteFilename.localeCompare(b.remoteFilename, undefined, { numeric: true })) };
}
