import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { Landing } from './Landing';
import { initPosthog } from './api/analytics';
import './styles/index.css';

initPosthog();

// /app renders editor, anything else renders landing; data-mode drives body overflow.
const path = window.location.pathname;
const isApp = path === '/app' || path.startsWith('/app/');
document.documentElement.dataset.mode = isApp ? 'app' : 'landing';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isApp ? <App /> : <Landing />}</React.StrictMode>,
);
