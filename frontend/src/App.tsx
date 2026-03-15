import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ReplayProvider } from './context/ReplayContext'
import AppShell from './components/AppShell'
import ProtectedRoute from './components/ProtectedRoute'
import AssetsPage from './pages/AssetsPage'
import BriefingPage from './pages/BriefingPage'
import GraphPage from './pages/GraphPage'
import GlobePage from './pages/GlobePage'
import DashboardPage from './pages/DashboardPage'
import LoginPage from './pages/LoginPage'
import MapPage from './pages/MapPage'
import SitesPage from './pages/SitesPage'
import TasksPage from './pages/TasksPage'

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
              <Route path="tasks" element={<TasksPage />} />
              <Route path="assets" element={<AssetsPage />} />
              <Route path="map" element={<MapPage />} />
              <Route path="graph" element={<GraphPage />} />
              <Route path="globe" element={<GlobePage />} />
              <Route path="briefing" element={<BriefingPage />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </ReplayProvider>
  )
}
