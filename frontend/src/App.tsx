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
import RecommendationsPage from './pages/RecommendationsPage'

export default function App() {
  return (
    <ReplayProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<AppShell />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<PageErrorBoundary pageName="Dashboard"><DashboardPage /></PageErrorBoundary>} />
              <Route path="sites" element={<PageErrorBoundary pageName="Sites"><SitesPage /></PageErrorBoundary>} />
              <Route path="sites/:id" element={<PageErrorBoundary pageName="Site Detail"><SiteDetailPage /></PageErrorBoundary>} />
              <Route path="tasks" element={<PageErrorBoundary pageName="Tasks"><TasksPage /></PageErrorBoundary>} />
              <Route path="assets" element={<PageErrorBoundary pageName="Assets"><AssetsPage /></PageErrorBoundary>} />
              <Route path="map" element={<PageErrorBoundary pageName="Map"><MapPage /></PageErrorBoundary>} />
              <Route path="graph" element={<PageErrorBoundary pageName="Graph"><GraphPage /></PageErrorBoundary>} />
              <Route path="globe" element={<PageErrorBoundary pageName="Globe"><GlobePage /></PageErrorBoundary>} />
              <Route path="briefing" element={<PageErrorBoundary pageName="Briefing"><BriefingPage /></PageErrorBoundary>} />
              <Route path="incidents" element={<PageErrorBoundary pageName="Incidents"><IncidentsPage /></PageErrorBoundary>} />
              <Route path="incidents/:id" element={<PageErrorBoundary pageName="Incident Detail"><IncidentDetailPage /></PageErrorBoundary>} />
              <Route path="recommendations" element={<PageErrorBoundary pageName="Recommendations"><RecommendationsPage /></PageErrorBoundary>} />
              <Route path="signals" element={<PageErrorBoundary pageName="Signals"><SignalFeedPage /></PageErrorBoundary>} />
              <Route path="rules" element={<PageErrorBoundary pageName="Rules"><CorrelationRulesPage /></PageErrorBoundary>} />
              <Route path="areas" element={<PageErrorBoundary pageName="Areas"><AreasPage /></PageErrorBoundary>} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </ReplayProvider>
  )
}
