import { invoke, isTauri } from "@tauri-apps/api/core";

export async function matchingCommand<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (isTauri()) return invoke<T>(command, args);
  const response = await fetch("/__forever_matching", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command, args }),
  });
  if (!response.ok) throw new Error(await response.text() || "Source matching unavailable. Start the local preview server or use the desktop app.");
  return response.json() as Promise<T>;
}
