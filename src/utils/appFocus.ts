import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * True when the person cannot currently see Forever: it is hidden in the tray,
 * minimized, or another program has focus. Falls back to the page's own focus
 * state when the native window cannot be queried.
 */
export async function appIsInBackground(): Promise<boolean> {
  if (isTauri()) {
    try {
      const window = getCurrentWindow();
      const [focused, visible, minimized] = await Promise.all([window.isFocused(), window.isVisible(), window.isMinimized()]);
      return !focused || !visible || minimized;
    } catch {
      // Fall through to the page.
    }
  }
  return document.visibilityState === "hidden" || !document.hasFocus();
}
