import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ReplayProvider } from './context/ReplayContext'
import AppShell from './components/AppShell'
import PageErrorBoundary from './components/PageErrorBoundary'
import ProtectedRoute from './components/ProtectedRoute'
import AssetsPage from './pages/AssetsPage'
import BriefingPage from './pages/BriefingPage'
import AreasPage from './pages/AreasPage'
import CorrelationRulesPage from './pages/CorrelationRulesPage'
import GraphPage from './pages/GraphPage'
import GlobePage from './pages/GlobePage'
import DashboardPage from './pages/DashboardPage'
import LoginPage from './pages/LoginPage'
import MapPage from './pages/MapPage'
import SignalFeedPage from './pages/SignalFeedPage'
import SiteDetailPage from './pages/SiteDetailPage'
import SitesPage from './pages/SitesPage'
import TasksPage from './pages/TasksPage'
import IncidentsPage from './pages/IncidentsPage'
import IncidentDetailPage from './pages/IncidentDetailPage'

export default function App() {
  return (
    <ReplayProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<AppShell />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="sites" element={<SitesPage />} />
              <Route path="sites/:id" element={<SiteDetailPage />} />
              <Route path="tasks" element={<TasksPage />} />
              <Route path="assets" element={<AssetsPage />} />
              <Route path="map" element={<MapPage />} />
              <Route path="graph" element={<GraphPage />} />
              <Route path="globe" element={
                <PageErrorBoundary pageName="Globe">
                  <GlobePage />
                </PageErrorBoundary>
              } />
              <Route path="briefing" element={
                <PageErrorBoundary pageName="Briefing">
                  <BriefingPage />
                </PageErrorBoundary>
              } />
              <Route path="incidents" element={<IncidentsPage />} />
              <Route path="incidents/:id" element={<IncidentDetailPage />} />
              <Route path="signals" element={<SignalFeedPage />} />
              <Route path="rules" element={<CorrelationRulesPage />} />
              <Route path="areas" element={<AreasPage />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </ReplayProvider>
  )
}
