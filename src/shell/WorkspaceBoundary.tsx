import { Component, Suspense, type ReactNode } from "react";

class WorkspaceErrorBoundary extends Component<
  { label: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <section className="workspace-status" role="alert">
          <h1>{this.props.label} could not open</h1>
          <p>
            Try another workspace. If this continues, restart Forever when your
            downloads are safe.
          </p>
        </section>
      );
    return this.props.children;
  }
}

export function WorkspaceBoundary({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <WorkspaceErrorBoundary label={label}>
      <Suspense
        fallback={
          <section
            className="workspace-status"
            role="status"
            aria-live="polite"
          >
            Loading {label}…
          </section>
        }
      >
        {children}
      </Suspense>
    </WorkspaceErrorBoundary>
  );
}
