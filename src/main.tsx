import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Barlow sets the interface; Martian Mono (weight and width axes) sets codes, times and figures.
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import '@fontsource-variable/martian-mono/standard.css';
import './styles/app.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
