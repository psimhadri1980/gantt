import { renderToString } from 'react-dom/server';
import { App } from './App.tsx';

/** Called by server.mjs for each request: the page's HTML as a string, ready to put inside #root. */
export function render(): string {
  return renderToString(<App />);
}
