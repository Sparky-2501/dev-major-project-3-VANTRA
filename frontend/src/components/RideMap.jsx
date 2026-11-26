
import { useState } from 'react'
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMapEvents
} from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const pickupIcon = new L.DivIcon({
  className: 'vantra-map-marker',
  html: '<div class="map-pin pickup-pin">P</div>',
  iconSize: [32, 32],
  iconAnchor: [16, 16]
})

const dropIcon = new L.DivIcon({
  className: 'vantra-map-marker',
  html: '<div class="map-pin drop-pin">D</div>',
  iconSize: [32, 32],
  iconAnchor: [16, 16]
})

function MapClick({ mode, onSelect }) {
  useMapEvents({
    click(event) {
      onSelect(mode, {
        lat: event.latlng.lat,
        lng: event.latlng.lng
      })
    }
  })

  return null
}

export default function RideMap({
  pickup,
  dropoff,
  onSelect
}) {
  const [mode, setMode] = useState('pickup')

  return (
    <div className="map-wrapper">
      <div className="map-toolbar">
        <button
          className={mode === 'pickup' ? 'active' : ''}
          onClick={() => setMode('pickup')}
        >
          <span className="pickup-dot" /> Select Pickup
        </button>

        <button
          className={mode === 'dropoff' ? 'active' : ''}
          onClick={() => setMode('dropoff')}
        >
          <span className="drop-dot" /> Select Destination
        </button>
      </div>

      <MapContainer
        center={[18.5204, 73.8567]}
        zoom={13}
        scrollWheelZoom
        className="ride-map"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapClick
          mode={mode}
          onSelect={onSelect}
        />

        {pickup && (
          <Marker
            position={[pickup.lat, pickup.lng]}
            icon={pickupIcon}
          >
            <Popup>Pickup location</Popup>
          </Marker>
        )}

        {dropoff && (
          <Marker
            position={[dropoff.lat, dropoff.lng]}
            icon={dropIcon}
          >
            <Popup>Destination</Popup>
          </Marker>
        )}
      </MapContainer>

      <p className="map-hint">
        Click a location on the map to set your {mode}.
      </p>
    </div>
  )
}
