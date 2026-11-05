import { Component, type ReactNode } from 'react';

interface Props {
  onError: (error: unknown) => void;
  children: ReactNode;
}

/** Catches failures of the lazily loaded globe (e.g. the 3D chunk failing to download). */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
