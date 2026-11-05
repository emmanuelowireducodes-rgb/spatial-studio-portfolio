import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

type BoundaryState = { error: Error | null };

class ApplicationErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Spatial Studio application failed to render:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return <main className="application-error" role="alert">
        <section>
          <span>SPATIAL STUDIO</span>
          <h1>The portfolio could not be displayed.</h1>
          <p>Reload the page to try again. Your projects and portfolio data are unchanged.</p>
          <button onClick={() => window.location.reload()}>Reload page</button>
        </section>
      </main>;
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Required #root mount element is missing.');
createRoot(rootElement).render(<React.StrictMode><ApplicationErrorBoundary><App /></ApplicationErrorBoundary></React.StrictMode>);
