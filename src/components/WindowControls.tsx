import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "@phosphor-icons/react";

const appWindow = isTauri() ? getCurrentWindow() : null;

export function WindowControls() {
  const minimize = () => void appWindow?.minimize();
  const maximize = () => void appWindow?.toggleMaximize();
  const close = () => void appWindow?.close();

  return (
    <div className="window-controls" aria-label="Window controls">
      <button type="button" aria-label="Minimize" onClick={minimize}>
        <Minus size={13} weight="bold" />
      </button>
      <button type="button" aria-label="Maximize" onClick={maximize}>
        <Square size={11} weight="regular" />
      </button>
      <button
        type="button"
        className="window-control-close"
        aria-label="Close"
        onClick={close}
      >
        <X size={13} weight="bold" />
      </button>
    </div>
  );
}
