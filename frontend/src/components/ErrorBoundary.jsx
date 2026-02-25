import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
    this.setState({
      error,
      errorInfo
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col h-screen bg-gray-950 text-white p-5 justify-center">
          <h1 className="text-2xl font-bold text-red-500 mb-4">App Error</h1>
          <details className="text-sm text-gray-300 bg-gray-900 p-4 rounded">
            <summary className="cursor-pointer font-semibold">Details</summary>
            <pre className="mt-3 overflow-auto max-h-64 text-xs">
              {this.state.error?.toString()}
              {'\n\n'}
              {this.state.errorInfo?.componentStack}
            </pre>
          </details>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded"
          >
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
