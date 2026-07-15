import { Component, type ErrorInfo, type ReactNode } from 'react';
import i18n from '@renderer/i18n';
import { ErrorState } from './ErrorState';

interface Props {
  children: ReactNode;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-1 items-center justify-center p-8">
          <ErrorState
            message={this.props.fallbackMessage ?? i18n.t('errors.common.pageRenderFailed')}
            onRetry={this.handleRetry}
          />
        </div>
      );
    }
    return this.props.children;
  }
}
