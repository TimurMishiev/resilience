import { OverlayToaster, Position } from '@blueprintjs/core'

export const AppToaster = OverlayToaster.createAsync({
  position: Position.TOP_RIGHT,
  maxToasts: 5,
})
