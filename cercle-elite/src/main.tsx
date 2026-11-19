import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

// L'espace d'administration est chargé à part : il n'alourdit pas le site public.
const Admin = lazy(() => import('./Admin'));
const isAdminRoute = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/');

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    {isAdminRoute ? <Suspense fallback={null}><Admin /></Suspense> : <App />}
  </ErrorBoundary>,
);
