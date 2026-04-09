import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Posture } from '../api/types'

const replayState = vi.hoisted(() => ({
  isReplaying: false,
  asOf: null as string | null,
}))

const areaState = vi.hoisted(() => ({
  areas: [] as Array<{ id: string; posture: Posture }>,
}))

const navbarState = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}))

const useAreasOfOperation = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  Outlet: () => <div data-testid="shell-outlet">outlet</div>,
  useNavigate: () => vi.fn(),
}))

vi.mock('../context/ReplayContext', () => ({
  useReplay: () => replayState,
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: {
      id: 'user-1',
      email: 'commander@resilience.test',
      role: 'commander',
    },
    logout: vi.fn(),
  }),
}))

vi.mock('../hooks/useRole', () => ({
  useRole: () => ({
    isCommander: true,
  }),
}))

vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}))

vi.mock('../hooks/useAreasOfOperation', () => ({
  useAreasOfOperation: (...args: unknown[]) => {
    useAreasOfOperation(...args)
    return {
      data: { data: areaState.areas },
    }
  },
}))

vi.mock('../hooks/useSseEvents', () => ({
  useSseEvents: () => ({
    status: 'open',
  }),
}))

vi.mock('../components/GlobalSearch', () => ({
  default: () => <div data-testid="global-search" />,
}))

vi.mock('../components/shell/AppSidebar', () => ({
  AppSidebar: () => <div data-testid="app-sidebar" />,
  AppBottomNav: () => <div data-testid="app-bottom-nav" />,
}))

vi.mock('../components/shell/AppBanners', () => ({
  AppBanners: () => <div data-testid="app-banners" />,
}))

vi.mock('../components/shell/AppNavbar', () => ({
  AppNavbar: (props: Record<string, unknown>) => {
    navbarState.props = props
    return (
      <div data-testid="app-navbar">
        {String(props.missionPosture)}:{String(props.hasMissionPosture)}
      </div>
    )
  },
}))

import AppShell from '../components/AppShell'

describe('AppShell', () => {
  beforeEach(() => {
    replayState.isReplaying = false
    replayState.asOf = null
    areaState.areas = []
    navbarState.props = null
    useAreasOfOperation.mockReset()
  })

  it('loads replay-scoped AO posture and keeps mission posture visible during replay', () => {
    replayState.isReplaying = true
    replayState.asOf = '2026-04-09T12:00:00Z'
    areaState.areas = [
      { id: 'ao-1', posture: 'observe' },
      { id: 'ao-2', posture: 'weapons_free' },
    ]

    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AppShell />
      </QueryClientProvider>,
    )

    expect(useAreasOfOperation).toHaveBeenCalledWith(
      { as_of: '2026-04-09T12:00:00Z' },
      { enabled: true, staleTime: 60_000 },
    )
    expect(navbarState.props?.missionPosture).toBe('weapons_free')
    expect(navbarState.props?.hasMissionPosture).toBe(true)
    expect(screen.getByTestId('shell-outlet')).toBeInTheDocument()
  })
})
