import "./styles/index.css";
import { ShellProvider } from "./shell/ShellProvider";
import { ShellFrame } from "./shell/ShellFrame";

export default function App() {
  return (
    <ShellProvider>
      <ShellFrame />
    </ShellProvider>
  );
}
