
import { useCallback, useEffect, useState } from 'react'
import {
  CarFront, MapPin, Clock, LayoutDashboard,
  ShieldCheck, LogOut, Navigation, CheckCircle2,
  XCircle, RefreshCw, Activity, Radio, Menu, X,
  AlertTriangle
} from 'lucide-react'

import {
  authAPI, riderAPI, driverAPI, adminAPI
} from './api'

import RideMap from './components/RideMap'

const defaultPoint = { lat: 18.5204, lng: 73.8567 }

function getError(error) {
  return error.response?.data?.message ||
    error.message || 'Something went wrong'
}

function getToken(data) {
  return data?.token ||
    data?.data?.token ||
    data?.accessToken ||
    data?.data?.accessToken
}

function getRideId(data) {
  return data?.ride?.id ||
    data?.ride?._id ||
    data?.id ||
    data?._id
}

// AUTHENTICATION

function AuthScreen({ onLogin }) {
  const [role, setRole] = useState('rider')
  const [mode, setMode] = useState('login')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    firstname: '',
    lastname: '',
    email: '',
    password: '',
    color: 'White',
    plate: '',
    capacity: 4,
    vehicleType: 'car'
  })

  const change = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      let result

      if (mode === 'register') {
        const data = {
          fullname: {
            firstname: form.firstname,
            lastname: form.lastname
          },
          email: form.email,
          password: form.password
        }

        if (role === 'driver') {
          data.vehicle = {
            color: form.color,
            plate: form.plate,
            capacity: Number(form.capacity),
            vehicleType: form.vehicleType
          }
        }

        result = await authAPI.register(role, data)
      } else {
        result = await authAPI.login(role, {
          email: form.email,
          password: form.password
        })
      }

      const token = getToken(result.data)

      if (!token) {
        throw new Error('No authentication token returned by API.')
      }

      localStorage.setItem('vantra_token', token)
      localStorage.setItem('vantra_role', role)

      onLogin(role)

    } catch (err) {
      setError(getError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-layout">
      <div className="auth-brand">
        <div className="brand-logo"><CarFront size={26} /></div>
        <span>VANTRA</span>
      </div>

      <div className="auth-content">
        <div className="auth-card">
          <div className="eyebrow">WELCOME TO VANTRA</div>

          <h1>Move smarter.<br />Live better.</h1>
          <p className="muted">Your journey begins with one click.</p>

          <div className="role-tabs">
            {['rider', 'driver', 'admin'].map(r => (
              <button
                key={r}
                type="button"
                className={role === r ? 'selected' : ''}
                onClick={() => {
                  setRole(r)
                  if (r === 'admin') setMode('login')
                  setError('')
                }}
              >
                {r[0].toUpperCase() + r.slice(1)}
              </button>
            ))}
          </div>

          {role !== 'admin' ? (
            <div className="auth-switch">
              <button
                type="button"
                className={mode === 'login' ? 'selected' : ''}
                onClick={() => setMode('login')}
              >
                Sign in
              </button>
              <button
                type="button"
                className={mode === 'register' ? 'selected' : ''}
                onClick={() => setMode('register')}
              >
                Create account
              </button>
            </div>
          ) : (
            <p className="muted">
              Demo admin uses an existing valid rider account.
            </p>
          )}

          <form onSubmit={submit}>
            {mode === 'register' && role !== 'admin' && (
              <>
                <label>First name</label>
                <input
                  name="firstname"
                  value={form.firstname}
                  onChange={change}
                  required
                  placeholder="First name"
                />

                <label>Last name</label>
                <input
                  name="lastname"
                  value={form.lastname}
                  onChange={change}
                  placeholder="Last name"
                />

                {role === 'driver' && (
                  <>
                    <label>Vehicle color</label>
                    <input name="color" value={form.color} onChange={change} required />

                    <label>Vehicle registration</label>
                    <input name="plate" value={form.plate} onChange={change} required />

                    <label>Vehicle type</label>
                    <select name="vehicleType" value={form.vehicleType} onChange={change}>
                      <option value="car">Car</option>
                      <option value="motorcycle">Motorcycle</option>
                      <option value="auto">Auto</option>
                    </select>

                    <label>Capacity</label>
                    <input
                      name="capacity"
                      type="number"
                      min="1"
                      max="8"
                      value={form.capacity}
                      onChange={change}
                      required
                    />
                  </>
                )}
              </>
            )}

            <label>Email address</label>
            <input
              name="email"
              type="email"
              value={form.email}
              onChange={change}
              required
              placeholder="you@example.com"
            />

            <label>Password</label>
            <input
              name="password"
              type="password"
              value={form.password}
              onChange={change}
              minLength={6}
              required
              placeholder="Enter password"
            />

            {error && <div className="error">{error}</div>}

            <button className="primary full" disabled={loading} type="submit">
              {loading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <p className="auth-foot">
            Secure access powered by Vantra microservices.
          </p>
        </div>
      </div>
    </div>
  )
}

// SIDEBAR

function Sidebar({ role, page, setPage, logout, mobile, close }) {
  const items = role === 'rider'
    ? [
        ['overview', LayoutDashboard, 'Overview'],
        ['book', MapPin, 'Book a ride'],
        ['history', Clock, 'Ride history']
      ]
    : role === 'driver'
      ? [
          ['overview', LayoutDashboard, 'Overview'],
          ['offers', CarFront, 'Ride requests']
        ]
      : [
          ['overview', LayoutDashboard, 'Overview'],
          ['services', Activity, 'Service health'],
          ['failures', ShieldCheck, 'Failure demos']
        ]

  return (
    <aside className={`sidebar ${mobile ? 'mobile-open' : ''}`}>
      <div className="sidebar-brand">
        <div className="brand-logo"><CarFront /></div>
        VANTRA
        {mobile && (
          <button className="icon-button" onClick={close} type="button">
            <X />
          </button>
        )}
      </div>

      <div className="sidebar-label">WORKSPACE</div>

      {items.map(([id, Icon, label]) => (
        <button
          key={id}
          onClick={() => {
            setPage(id)
            close()
          }}
          className={`nav-item ${page === id ? 'active' : ''}`}
          type="button"
        >
          <Icon size={19} />
          {label}
        </button>
      ))}

      <div className="sidebar-bottom">
        <div className="user-mini">
          <div className="avatar">{role[0].toUpperCase()}</div>
          <div>
            <strong>{role[0].toUpperCase() + role.slice(1)}</strong>
            <small>Vantra account</small>
          </div>
        </div>

        <button className="nav-item logout" onClick={logout} type="button">
          <LogOut size={18} />
          Sign out
        </button>
      </div>
    </aside>
  )
}

// RIDER DASHBOARD

function RiderDashboard({ page }) {
  const [pickup, setPickup] = useState(defaultPoint)
  const [dropoff, setDropoff] = useState({
    lat: 18.5404,
    lng: 73.8767
  })

  const [rides, setRides] = useState([])
  const [ride, setRide] = useState(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const result = await riderAPI.history()
      setRides(
        Array.isArray(result.data)
          ? result.data
          : result.data?.rides || []
      )
    } catch (err) {
      setError(getError(err))
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const id = getRideId(ride)
    if (!id) return

    const timer = setInterval(async () => {
      try {
        const result = await riderAPI.ride(id)
        setRide(result.data?.ride || result.data)
      } catch {
        // Keep previous ride state.
      }
    }, 5000)

    return () => clearInterval(timer)
  }, [ride])

  async function bookRide() {
    setLoading(true)
    setError('')
    setMessage('')

    try {
      const result = await riderAPI.book(
        { pickup, dropoff },
        `vantra-${crypto.randomUUID()}`
      )

      setRide(result.data.ride || result.data)
      setMessage('Ride request submitted.')
      await refresh()
    } catch (err) {
      setError(getError(err))
    } finally {
      setLoading(false)
    }
  }

  async function cancelRide(id) {
    try {
      await riderAPI.cancel(id)
      setMessage('Cancellation request submitted.')
      await refresh()
    } catch (err) {
      setError(getError(err))
    }
  }

  function selectLocation(mode, point) {
    if (mode === 'pickup') setPickup(point)
    else setDropoff(point)
  }

  return (
    <>
      {page === 'book' || page === 'overview' ? (
        <>
          <div className="page-heading">
            <div>
              <div className="eyebrow">RIDER WORKSPACE</div>
              <h1>{page === 'book' ? 'Book your ride' : 'Your next journey starts here'}</h1>
              <p>Travel comfortably. Arrive confidently.</p>
            </div>
            <span className="status-pill"><span /> Gateway connected</span>
          </div>

          <div className="rider-grid">
            <section className="panel booking-panel">
              <div className="panel-heading">
                <div>
                  <h2>Plan your journey</h2>
                  <p>Select your pickup and destination.</p>
                </div>
                <Navigation className="green-icon" />
              </div>

              <div className="coordinate-card">
                <div className="coordinate-row">
                  <span className="pickup-dot" />
                  <div>
                    <small>PICKUP</small>
                    <strong>{pickup.lat.toFixed(5)}, {pickup.lng.toFixed(5)}</strong>
                  </div>
                </div>

                <div className="coordinate-line" />

                <div className="coordinate-row">
                  <span className="drop-dot" />
                  <div>
                    <small>DESTINATION</small>
                    <strong>{dropoff.lat.toFixed(5)}, {dropoff.lng.toFixed(5)}</strong>
                  </div>
                </div>
              </div>

              <RideMap
                pickup={pickup}
                dropoff={dropoff}
                onSelect={selectLocation}
              />

              <button
                className="primary full book-button"
                onClick={bookRide}
                disabled={loading}
                type="button"
              >
                <CarFront size={19} />
                {loading ? 'Requesting ride...' : 'Confirm and book ride'}
              </button>
            </section>

            <section className="right-stack">
              <div className="panel welcome-panel">
                <div className="eyebrow">VANTRA EXPERIENCE</div>
                <h2>Your city.<br />Your journey.</h2>
                <p>Smart driver matching and reliable ride management.</p>
                <div className="welcome-icon"><CarFront size={46} /></div>
              </div>

              <div className="panel">
                <h3>Current ride</h3>
                {ride ? (
                  <>
                    <div className="ride-status">{ride.status || 'REQUESTED'}</div>
                    <p className="muted">Ride ID: {getRideId(ride)}</p>
                  </>
                ) : (
                  <p className="muted">No active ride selected.</p>
                )}
              </div>
            </section>
          </div>
        </>
      ) : (
        <div className="panel">
          <div className="panel-heading">
            <div>
              <h2>Ride history</h2>
              <p>Your previous and current ride requests.</p>
            </div>
            <button className="secondary" onClick={refresh} type="button">
              <RefreshCw size={16} /> Refresh
            </button>
          </div>

          {rides.length === 0 ? (
            <div className="empty-state">No rides found yet.</div>
          ) : rides.map((item, i) => {
            const id = getRideId(item)

            return (
              <div className="history-item" key={id || i}>
                <div className="avatar"><CarFront /></div>
                <div className="history-main">
                  <strong>Ride #{String(id || i + 1).slice(-8)}</strong>
                  <small>{item.status || 'REQUESTED'}</small>
                </div>

                {id && (
                  <button
                    className="secondary"
                    onClick={async () => {
                      try {
                        const result = await riderAPI.ride(id)
                        setRide(result.data?.ride || result.data)
                        setMessage(`Viewing ride ${id}`)
                      } catch (err) {
                        setError(getError(err))
                      }
                    }}
                    type="button"
                  >
                    Details
                  </button>
                )}

                {id && ['REQUESTED', 'DRIVER_ASSIGNED'].includes(item.status) && (
                  <button
                    className="danger-button"
                    onClick={() => cancelRide(id)}
                    type="button"
                  >
                    Cancel
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {message && <div className="success message"><CheckCircle2 size={17} />{message}</div>}
      {error && <div className="error message"><AlertTriangle size={17} />{error}</div>}
    </>
  )
}

// PART 2 GOES BELOW THIS LINE

 
// DRIVER DASHBOARD

function DriverDashboard({ page }) {
  const [online, setOnline] = useState(false)
  const [offers, setOffers] = useState([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const result = await driverAPI.status()
      setOnline(
        result.data?.online ??
        result.data?.status === 'online'
      )

      const pending = await driverAPI.pendingOffers()
      setOffers(
        Array.isArray(pending.data)
          ? pending.data
          : pending.data?.offers || []
      )
    } catch (err) {
      setError(getError(err))
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 8000)
    return () => clearInterval(timer)
  }, [refresh])

  async function toggleStatus() {
    setLoading(true)
    setError('')
    try {
      await driverAPI.setStatus(!online)
      setOnline(!online)
      setMessage(!online ? 'You are now online.' : 'You are now offline.')
    } catch (err) {
      setError(getError(err))
    } finally {
      setLoading(false)
    }
  }

  async function updateLocation() {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by this browser.')
      return
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          await driverAPI.updateLocation({
            lng: position.coords.longitude,
            lat: position.coords.latitude
          })
          setMessage('Location updated successfully.')
        } catch (err) {
          setError(getError(err))
        }
      },
      () => setError('Please allow location access in your browser.')
    )
  }

  async function respond(id, action) {
    setLoading(true)
    setError('')

    try {
      await driverAPI.respond(id, action)
      setMessage(action === 'accept' ? 'Ride accepted!' : 'Ride declined.')
      await refresh()
    } catch (err) {
      setError(getError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">DRIVER WORKSPACE</div>
          <h1>{page === 'offers' ? 'Ride requests' : 'Driver dashboard'}</h1>
          <p>Manage your availability and incoming rides.</p>
        </div>

        <span className={`status-pill ${online ? 'online' : ''}`}>
          <span />
          {online ? 'Online' : 'Offline'}
        </span>
      </div>

      <div className="stats-grid">
        <div className="panel stat-card">
          <div className="stat-icon green"><Activity /></div>
          <small>Availability</small>
          <h2>{online ? 'Online' : 'Offline'}</h2>
        </div>

        <div className="panel stat-card">
          <div className="stat-icon blue"><CarFront /></div>
          <small>Pending requests</small>
          <h2>{offers.length}</h2>
        </div>

        <div className="panel stat-card">
          <div className="stat-icon orange"><Navigation /></div>
          <small>Service</small>
          <h2>Active</h2>
        </div>
      </div>

      {page === 'overview' && (
        <div className="panel driver-control">
          <div>
            <h2>Manage availability</h2>
            <p>Go online to receive nearby ride requests.</p>
          </div>

          <div className="driver-actions">
            <button
              className={online ? 'danger-button' : 'primary'}
              onClick={toggleStatus}
              disabled={loading}
              type="button"
            >
              {loading ? 'Please wait...' : online ? 'Go offline' : 'Go online'}
            </button>

            <button className="secondary" onClick={updateLocation} type="button">
              <MapPin size={17} /> Update location
            </button>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-heading">
          <div>
            <h2>Incoming ride requests</h2>
            <p>Accept or decline offers from matching service.</p>
          </div>

          <button className="secondary" onClick={refresh} type="button">
            <RefreshCw size={16} /> Refresh
          </button>
        </div>

        {!online && (
          <div className="notice">
            <AlertTriangle size={18} />
            You are offline. Go online to receive ride requests.
          </div>
        )}

        {offers.length === 0 ? (
          <div className="empty-state">
            <CarFront size={36} />
            <h3>No pending requests</h3>
            <p>New ride offers will appear here.</p>
          </div>
        ) : (
          offers.map((offer, index) => {
            const id = offer.rideId || offer.ride?.id || offer._id

            return (
              <div className="offer-card" key={id || index}>
                <div className="offer-info">
                  <div className="avatar"><MapPin /></div>
                  <div>
                    <strong>Ride request</strong>
                    <small>Ride ID: {id}</small>
                    <small>Status: {offer.status || 'OFFERED'}</small>
                  </div>
                </div>

                <div className="offer-actions">
                  <button
                    className="primary"
                    disabled={loading || !id}
                    onClick={() => respond(id, 'accept')}
                    type="button"
                  >
                    <CheckCircle2 size={16} /> Accept
                  </button>

                  <button
                    className="danger-button"
                    disabled={loading || !id}
                    onClick={() => respond(id, 'decline')}
                    type="button"
                  >
                    <XCircle size={16} /> Decline
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {message && <div className="success message">{message}</div>}
      {error && <div className="error message">{error}</div>}
    </>
  )
}

// ADMIN / DEMO DASHBOARD

function AdminDashboard({ page }) {
  const [status, setStatus] = useState(null)
  const [failRate, setFailRate] = useState(0)
  const [outage, setOutage] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const result = await adminAPI.status()
      setStatus(result.data)
    } catch (err) {
      setError(getError(err))
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 10000)
    return () => clearInterval(timer)
  }, [refresh])

  async function changeFailureRate(rate) {
    setLoading(true)
    setError('')
    try {
      await adminAPI.setPaymentFailure(rate)
      setFailRate(rate)
      setMessage(`Payment failure rate set to ${rate * 100}%.`)
    } catch (err) {
      setError(getError(err))
    } finally {
      setLoading(false)
    }
  }

  async function toggleOutage(value) {
    setLoading(true)
    setError('')
    try {
      await adminAPI.setDriverOutage(value)
      setOutage(value)
      setMessage(value ? 'Driver service outage enabled.' : 'Driver service restored.')
    } catch (err) {
      setError(getError(err))
    } finally {
      setLoading(false)
    }
  }

  const breakers = status?.breakers || {}

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">SYSTEM CONTROL CENTER</div>
          <h1>{page === 'failures' ? 'Failure simulations' : page === 'services' ? 'Service health' : 'System overview'}</h1>
          <p>Observe and demonstrate distributed system behaviour.</p>
        </div>

        <span className="status-pill online">
          <span /> Monitoring
        </span>
      </div>

      {page === 'overview' && (
        <div className="stats-grid">
          <div className="panel stat-card">
            <div className="stat-icon green"><Activity /></div>
            <small>Gateway status</small>
            <h2>{status?.status || 'Unknown'}</h2>
          </div>

          <div className="panel stat-card">
            <div className="stat-icon blue"><ShieldCheck /></div>
            <small>Services monitored</small>
            <h2>{Object.keys(status?.checks || {}).length}</h2>
          </div>

          <div className="panel stat-card">
            <div className="stat-icon orange"><Radio /></div>
            <small>Active breakers</small>
            <h2>{Object.keys(breakers).length}</h2>
          </div>
        </div>
      )}

      {page === 'services' || page === 'overview' ? (
        <div className="panel">
          <div className="panel-heading">
            <div>
              <h2>Microservice health</h2>
              <p>Live response from the API gateway.</p>
            </div>

            <button className="secondary" onClick={refresh} type="button">
              <RefreshCw size={16} /> Refresh
            </button>
          </div>

          {status?.checks && Object.entries(status.checks).map(([name, value]) => (
            <div className="service-row" key={name}>
              <div>
                <strong>{name}</strong>
                <small>Microservice dependency</small>
              </div>

              <span className={`health-badge ${value === 'up' ? 'healthy' : 'unhealthy'}`}>
                {String(value)}
              </span>
            </div>
          ))}

          {Object.keys(breakers).length > 0 && (
            <>
              <h3 className="section-heading">Circuit breakers</h3>

              {Object.entries(breakers).map(([name, value]) => (
                <div className="service-row" key={name}>
                  <strong>{name}</strong>
                  <span className="health-badge healthy">
                    {typeof value === 'object' ? value.state || JSON.stringify(value) : String(value)}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      ) : null}

      {page === 'failures' && (
        <div className="failure-grid">
          <div className="panel failure-card">
            <div className="stat-icon orange"><AlertTriangle /></div>
            <h2>Payment failure</h2>
            <p>Simulate payment authorization failures and observe Saga compensation.</p>

            <label>Failure probability: {Math.round(failRate * 100)}%</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={failRate}
              onChange={e => setFailRate(Number(e.target.value))}
            />

            <div className="range-labels">
              <span>0%</span>
              <span>100%</span>
            </div>

            <button
              className="primary full"
              disabled={loading}
              onClick={() => changeFailureRate(failRate)}
              type="button"
            >
              Apply payment failure rate
            </button>
          </div>

          <div className="panel failure-card">
            <div className="stat-icon orange"><CarFront /></div>
            <h2>Driver service outage</h2>
            <p>Make driver-service unavailable and watch Saga compensation retry.</p>

            <div className="outage-status">
              <span className={`status-dot ${outage ? 'red' : 'green'}`} />
              {outage ? 'Outage enabled' : 'Service available'}
            </div>

            <button
              className={outage ? 'primary full' : 'danger-button full'}
              disabled={loading}
              onClick={() => toggleOutage(!outage)}
              type="button"
            >
              {outage ? 'Restore driver service' : 'Enable driver outage'}
            </button>
          </div>
        </div>
      )}

      {message && <div className="success message">{message}</div>}
      {error && <div className="error message">{error}</div>}
    </>
  )
}

// MAIN APPLICATION

export default function App() {
  const [role, setRole] = useState(
    localStorage.getItem('vantra_role')
  )

  const [page, setPage] = useState('overview')
  const [mobile, setMobile] = useState(false)

  function logout() {
    localStorage.removeItem('vantra_token')
    localStorage.removeItem('vantra_role')
    setRole(null)
  }

  if (!role || !localStorage.getItem('vantra_token')) {
    return <AuthScreen onLogin={setRole} />
  }

  return (
    <div className="app-layout">
      {mobile && (
        <div
          className="mobile-overlay"
          onClick={() => setMobile(false)}
        />
      )}

      <Sidebar
        role={role}
        page={page}
        setPage={setPage}
        logout={logout}
        mobile={mobile}
        close={() => setMobile(false)}
      />

      <main className="main-content">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setMobile(true)}
            type="button"
          >
            <Menu />
          </button>

          <div className="breadcrumb">
            Workspace <span>/</span> {page}
          </div>

          <div className="topbar-right">
            <span className="live-indicator">
              <span /> LIVE
            </span>
            <div className="avatar">{role[0].toUpperCase()}</div>
          </div>
        </header>

        <div className="page-content">
          {role === 'rider' && (
            <RiderDashboard page={page} />
          )}

          {role === 'driver' && (
            <DriverDashboard page={page} />
          )}

          {role === 'admin' && (
            <AdminDashboard page={page} />
          )}
        </div>

        <footer className="app-footer">
          VANTRA © 2026 · Distributed Ride-Hailing Platform
        </footer>
      </main>
    </div>
  )
}
