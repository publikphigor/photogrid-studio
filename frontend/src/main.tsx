import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { Landing } from './Landing';
import './styles/index.css';

// Routing is intentionally trivial: /app (and anything under it) renders the
// editor; everything else renders the landing page. The two routes share a
// single index.html, so nginx's SPA fallback covers both. The data-mode
// attribute drives a CSS opt-in for body { overflow: hidden } — the editor
// fills the viewport, the landing page scrolls.
const path = window.location.pathname;
const isApp = path === '/app' || path.startsWith('/app/');
document.documentElement.dataset.mode = isApp ? 'app' : 'landing';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isApp ? <App /> : <Landing />}</React.StrictMode>,
);
