// Playback rates: simulated minutes advanced per real second of playback.
export const PLAYBACK_RATES = [1, 5, 15, 60] as const
export type PlaybackRate = (typeof PLAYBACK_RATES)[number]

// Minutes jumped per step-forward / step-backward button press.
export const REPLAY_STEP_MINUTES = 5

// Step controls stay within the recent operational window; deeper history
// remains reachable via explicit datetime entry.
export const REPLAY_STEP_LOOKBACK_DAYS = 30
