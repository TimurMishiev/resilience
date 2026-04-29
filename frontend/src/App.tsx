import { lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { NonIdealState } from '@blueprintjs/core'
import { ReplayProvider } from './context/ReplayContext'
import AppShell from './components/AppShell'
import PageErrorBoundary from './components/PageErrorBoundary'
import ProtectedRoute from './components/ProtectedRoute'
// LoginPage is eagerly loaded — it is the first thing an unauthenticated user
// sees and must render without a network round-trip for the JS chunk.
import LoginPage from './pages/LoginPage'

// All protected pages are lazy-loaded so Vite can split them into separate
// chunks.  Each chunk is only downloaded when the user first navigates to that
// route.  PageErrorBoundary (which wraps every route) embeds a <Suspense>
// fallback so load errors are caught and displayed in-page rather than
// crashing the whole shell.
const AlertTriagePage     = lazy(() => import('./pages/AlertTriagePage'))
const AssetsPage          = lazy(() => import('./pages/AssetsPage'))
const BriefingPage        = lazy(() => import('./pages/BriefingPage'))
const DebriefPage         = lazy(() => import('./pages/DebriefPage'))
const AreasPage           = lazy(() => import('./pages/AreasPage'))
const CorrelationRulesPage = lazy(() => import('./pages/CorrelationRulesPage'))
const GraphPage           = lazy(() => import('./pages/GraphPage'))
const GlobePage           = lazy(() => import('./pages/GlobePage'))
const DashboardPage       = lazy(() => import('./pages/DashboardPage'))
const MapPage             = lazy(() => import('./pages/MapPage'))
const SignalFeedPage      = lazy(() => import('./pages/SignalFeedPage'))
const SiteDetailPage      = lazy(() => import('./pages/SiteDetailPage'))
const SitesPage           = lazy(() => import('./pages/SitesPage'))
const TasksPage           = lazy(() => import('./pages/TasksPage'))
const IncidentsPage       = lazy(() => import('./pages/IncidentsPage'))
const IncidentDetailPage  = lazy(() => import('./pages/IncidentDetailPage'))
const RecommendationsPage = lazy(() => import('./pages/RecommendationsPage'))
const SecurityPage        = lazy(() => import('./pages/SecurityPage'))
const PlanningPage        = lazy(() => import('./pages/PlanningPage'))
const OntologyQueryPage   = lazy(() => import('./pages/OntologyQueryPage'))
const SwimlanePage        = lazy(() => import('./pages/SwimlanePage'))
const OperationalHealthPage = lazy(() => import('./pages/OperationalHealthPage'))
const OrganizationsPage    = lazy(() => import('./pages/OrganizationsPage'))
const UsersPage            = lazy(() => import('./pages/UsersPage'))

export default function App() {
  return (
    <ReplayProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<AppShell />}>
              <Route index element={<Navigate to="/sites" replace />} />
              <Route path="dashboard" element={<PageErrorBoundary pageName="Dashboard"><DashboardPage /></PageErrorBoundary>} />
              <Route path="sites" element={<PageErrorBoundary pageName="Sites"><SitesPage /></PageErrorBoundary>} />
              <Route path="sites/:id" element={<PageErrorBoundary pageName="Site Detail"><SiteDetailPage /></PageErrorBoundary>} />
              <Route path="tasks" element={<PageErrorBoundary pageName="Tasks"><TasksPage /></PageErrorBoundary>} />
              <Route path="assets" element={<PageErrorBoundary pageName="Assets"><AssetsPage /></PageErrorBoundary>} />
              <Route path="map" element={<PageErrorBoundary pageName="Map"><MapPage /></PageErrorBoundary>} />
              <Route path="graph" element={<PageErrorBoundary pageName="Graph"><GraphPage /></PageErrorBoundary>} />
              <Route path="globe" element={<PageErrorBoundary pageName="Globe"><GlobePage /></PageErrorBoundary>} />
              <Route path="briefing" element={<PageErrorBoundary pageName="Briefing"><BriefingPage /></PageErrorBoundary>} />
              <Route path="debrief" element={<PageErrorBoundary pageName="Debrief"><DebriefPage /></PageErrorBoundary>} />
              <Route path="ontology" element={<PageErrorBoundary pageName="Ontology Query"><OntologyQueryPage /></PageErrorBoundary>} />
              <Route path="incidents" element={<PageErrorBoundary pageName="Incidents"><IncidentsPage /></PageErrorBoundary>} />
              <Route path="incidents/:id" element={<PageErrorBoundary pageName="Incident Detail"><IncidentDetailPage /></PageErrorBoundary>} />
              <Route path="recommendations" element={<PageErrorBoundary pageName="Recommendations"><RecommendationsPage /></PageErrorBoundary>} />
              <Route path="security" element={<PageErrorBoundary pageName="Security"><SecurityPage /></PageErrorBoundary>} />
              <Route path="alerts" element={<PageErrorBoundary pageName="Alert Triage"><AlertTriagePage /></PageErrorBoundary>} />
              <Route path="signals" element={<PageErrorBoundary pageName="Signals"><SignalFeedPage /></PageErrorBoundary>} />
              <Route path="rules" element={<PageErrorBoundary pageName="Rules"><CorrelationRulesPage /></PageErrorBoundary>} />
              <Route path="areas" element={<PageErrorBoundary pageName="Areas"><AreasPage /></PageErrorBoundary>} />
              <Route path="planning" element={<PageErrorBoundary pageName="Planning"><PlanningPage /></PageErrorBoundary>} />
              <Route path="swimlane" element={<PageErrorBoundary pageName="Swimlane"><SwimlanePage /></PageErrorBoundary>} />
              <Route path="health" element={<PageErrorBoundary pageName="Operational Health"><OperationalHealthPage /></PageErrorBoundary>} />
              <Route path="organizations" element={<PageErrorBoundary pageName="Organizations"><OrganizationsPage /></PageErrorBoundary>} />
              <Route path="users" element={<PageErrorBoundary pageName="Users"><UsersPage /></PageErrorBoundary>} />
              <Route path="*" element={<NonIdealState icon="error" title="Page not found" description="The URL you entered does not match any page in this application." />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </ReplayProvider>
  )
}
