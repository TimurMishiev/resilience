import { MAP_STYLE_CONFIGS, type MapStyleKey } from '../../../hooks/useMapLibreEngine'

interface StyleSwitcherProps {
  mapStyle: MapStyleKey
  onMapStyleChange: (style: MapStyleKey) => void
}

export function StyleSwitcher({ mapStyle, onMapStyleChange }: StyleSwitcherProps) {
  return (
    <div className="map-style-switcher">
      {(Object.keys(MAP_STYLE_CONFIGS) as MapStyleKey[]).map(key => (
        <button
          key={key}
          className={`map-style-btn${mapStyle === key ? ' map-style-btn--active' : ''}`}
          onClick={() => onMapStyleChange(key)}
        >
          {MAP_STYLE_CONFIGS[key].label}
        </button>
      ))}
    </div>
  )
}
