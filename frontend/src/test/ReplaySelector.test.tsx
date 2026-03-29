import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaybackRate } from '../context/replayTransport'

// ---------------------------------------------------------------------------
// Mock useReplay so we control context state without a real provider
// ---------------------------------------------------------------------------
const replayState = vi.hoisted(() => ({
  asOf: null as string | null,
  isReplaying: false,
  isPlaying: false,
  playbackRate: 5 as PlaybackRate,
  setAsOf:         vi.fn(),
  play:            vi.fn(),
  pause:           vi.fn(),
  setPlaybackRate: vi.fn(),
  stepForward:     vi.fn(),
  stepBackward:    vi.fn(),
}))

vi.mock('../context/ReplayContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../context/ReplayContext')>()
  return {
    ...actual,
    useReplay: () => replayState,
  }
})

import ReplaySelector from '../components/ReplaySelector'

function renderSelector() {
  render(<ReplaySelector />)
}

describe('ReplaySelector', () => {
  beforeEach(() => {
    replayState.asOf        = null
    replayState.isReplaying = false
    replayState.isPlaying   = false
    replayState.playbackRate = 5
    replayState.setAsOf.mockReset()
    replayState.play.mockReset()
    replayState.pause.mockReset()
    replayState.setPlaybackRate.mockReset()
    replayState.stepForward.mockReset()
    replayState.stepBackward.mockReset()
  })

  describe('live mode', () => {
    it('shows LIVE tag', () => {
      renderSelector()
      expect(screen.getByText('LIVE')).toBeInTheDocument()
    })

    it('does not show transport controls', () => {
      renderSelector()
      expect(screen.queryByTitle('Start playback')).toBeNull()
      expect(screen.queryByTitle('Step back 5 minutes and pause')).toBeNull()
      expect(screen.queryByTitle('Return to live')).toBeNull()
    })
  })

  describe('replay mode', () => {
    beforeEach(() => {
      replayState.asOf        = '2026-03-01T10:00:00.000Z'
      replayState.isReplaying = true
    })

    it('shows REPLAY tag', () => {
      renderSelector()
      expect(screen.getByText('REPLAY')).toBeInTheDocument()
    })

    it('shows step-back, play, step-forward, rate buttons, and clear button', () => {
      renderSelector()
      expect(screen.getByTitle('Step back 5 minutes and pause')).toBeInTheDocument()
      expect(screen.getByTitle('Start playback')).toBeInTheDocument()
      expect(screen.getByTitle('Step forward 5 minutes and pause')).toBeInTheDocument()
      expect(screen.getByTitle('Return to live')).toBeInTheDocument()
      // All four rate buttons present
      expect(screen.getByText('1×')).toBeInTheDocument()
      expect(screen.getByText('5×')).toBeInTheDocument()
      expect(screen.getByText('15×')).toBeInTheDocument()
      expect(screen.getByText('60×')).toBeInTheDocument()
    })

    it('play button calls play()', async () => {
      renderSelector()
      await userEvent.click(screen.getByTitle('Start playback'))
      expect(replayState.play).toHaveBeenCalledOnce()
    })

    it('shows pause button when isPlaying=true and calls pause()', async () => {
      replayState.isPlaying = true
      renderSelector()
      const pauseBtn = screen.getByTitle('Pause playback')
      expect(pauseBtn).toBeInTheDocument()
      await userEvent.click(pauseBtn)
      expect(replayState.pause).toHaveBeenCalledOnce()
    })

    it('step-back button calls stepBackward()', async () => {
      renderSelector()
      await userEvent.click(screen.getByTitle('Step back 5 minutes and pause'))
      expect(replayState.stepBackward).toHaveBeenCalledOnce()
    })

    it('step-forward button calls stepForward()', async () => {
      renderSelector()
      await userEvent.click(screen.getByTitle('Step forward 5 minutes and pause'))
      expect(replayState.stepForward).toHaveBeenCalledOnce()
    })

    it('clicking a rate button calls setPlaybackRate with that rate', async () => {
      renderSelector()
      await userEvent.click(screen.getByText('60×'))
      expect(replayState.setPlaybackRate).toHaveBeenCalledWith(60)
    })

    it('active rate button has --active class', () => {
      replayState.playbackRate = 5
      renderSelector()
      expect(screen.getByRole('button', { name: '5×' }).className).toContain('replay-rate-btn--active')
      expect(screen.getByRole('button', { name: '1×' }).className).not.toContain('replay-rate-btn--active')
      expect(screen.getByRole('button', { name: '5×' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('button', { name: '1×' })).toHaveAttribute('aria-pressed', 'false')
    })

    it('clear button calls setAsOf(null)', async () => {
      renderSelector()
      await userEvent.click(screen.getByTitle('Return to live'))
      expect(replayState.setAsOf).toHaveBeenCalledWith(null)
    })

    it('commits an edited datetime value on blur', () => {
      renderSelector()
      const input = screen.getByTitle('Set replay timestamp — leave empty for live data')

      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: '2026-03-01T10:15' } })
      fireEvent.blur(input)

      expect(replayState.setAsOf).toHaveBeenCalledWith(new Date('2026-03-01T10:15').toISOString())
    })

    it('clearing the datetime input on blur returns to live', () => {
      renderSelector()
      const input = screen.getByTitle('Set replay timestamp — leave empty for live data')

      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: '' } })
      fireEvent.blur(input)

      expect(replayState.setAsOf).toHaveBeenCalledWith(null)
    })
  })
})
