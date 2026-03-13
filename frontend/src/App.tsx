import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ReplayProvider } from './context/ReplayContext'
import AppShell from './components/AppShell'
import AssetsPage from './pages/AssetsPage'
import MapPage from './pages/MapPage'
import SitesPage from './pages/SitesPage'
import TasksPage from './pages/TasksPage'

export default function App() {
  return (
    <ReplayProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<Navigate to="/sites" replace />} />
            <Route path="sites" element={<SitesPage />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="assets" element={<AssetsPage />} />
            <Route path="map" element={<MapPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ReplayProvider>
  )
}
