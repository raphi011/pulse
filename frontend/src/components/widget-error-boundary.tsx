"use client";
import { Component, type ReactNode } from "react";

/** Catches render errors from one widget body so a bad widget can't take down the dashboard. */
export class WidgetErrorBoundary extends Component<
  { resetKey: unknown; children: ReactNode; fallback?: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey: unknown }) {
    // A new payload (e.g. after a successful refresh) gets a fresh chance to render.
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (this.state.error) {
      // A caller can opt into a quieter fallback (e.g. header controls render nothing on crash
      // rather than injecting an error block into the header).
      if (this.props.fallback !== undefined) return this.props.fallback;
      return (
        <div className="flex items-start gap-2 text-sm text-danger">
          <span aria-hidden className="mt-px select-none">⚠</span>
          <p className="min-w-0 break-words">Widget crashed: {this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
