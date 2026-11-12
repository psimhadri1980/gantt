import { hydrateRoot } from 'react-dom/client';
import { App } from './App.tsx';

// Attach React to the server's HTML instead of rendering again. A mismatch is reported through
// onRecoverableError; the server-rendering test fails if anything is reported.
const w = window as unknown as { hydrationErrors: string[]; hydrated: boolean };
w.hydrationErrors = [];
hydrateRoot(document.getElementById('root')!, <App />, {
  onRecoverableError: (e) => { w.hydrationErrors.push(String(e instanceof Error ? e.message : e)); },
});
w.hydrated = true;
