import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initializeSettings, reportSettingsError } from "./settings";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
root.render(<p role="status">Loading settings…</p>);
void initializeSettings().catch(reportSettingsError).finally(() => root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
));
