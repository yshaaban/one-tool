import { Suspense, lazy } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Landing } from './pages/Landing';
import { ExampleIndex } from './pages/ExampleIndex';

const Playground = lazy(() => import('./pages/Playground'));
const ExamplePage = lazy(() => import('./pages/ExamplePage'));

export function App() {
  return (
    <HashRouter>
      <Layout>
        <Suspense fallback={<div className="loading">Loading...</div>}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/playground" element={<Playground />} />
            <Route path="/examples" element={<ExampleIndex />} />
            <Route path="/examples/:id" element={<ExamplePage />} />
          </Routes>
        </Suspense>
      </Layout>
    </HashRouter>
  );
}
