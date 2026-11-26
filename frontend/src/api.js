
import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: {
    'Content-Type': 'application/json'
  },
  timeout: 15000
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('vantra_token')

  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }

  return config
})


export const authAPI = {
  login: (role, data) =>
    api.post(
      `/${role === 'driver' ? 'drivers' : 'riders'}/login`,
      data
    ),

  register: (role, data) =>
    api.post(
      `/${role === 'driver' ? 'drivers' : 'riders'}/register`,
      data
    ),

  profile: (role) =>
    api.get(role === 'driver' ? '/drivers/profile' : '/riders/profile'),

  logout: (role) =>
    api.post(role === 'driver' ? '/drivers/logout' : '/riders/logout')
}


export const riderAPI = {
  book: (data, key) =>
    api.post('/rides', data, {
      headers: { 'Idempotency-Key': key }
    }),

  history: () => api.get('/rides'),

  ride: (id) => api.get(`/rides/${id}`),

  cancel: (id) => api.post(`/rides/${id}/cancel`)
}

export const driverAPI = {
  status: (online) => api.post('/drivers/status', { online }),

  getStatus: () => api.get('/drivers/status'),

  location: (lng, lat) =>
    api.post('/drivers/location', { lng, lat }),

  offers: () => api.get('/matching/offers/pending'),

  accept: (id) => api.post(`/matching/offers/${id}/accept`),

  decline: (id) => api.post(`/matching/offers/${id}/decline`),

  start: (id) => api.post(`/matching/rides/${id}/start`),

  complete: (id) => api.post(`/matching/rides/${id}/complete`)
}

export const adminAPI = {
  status: () => axios.get('/status', {
    baseURL: ''
  }),

  health: () => axios.get('/health', {
    baseURL: ''
  }),

  paymentFailure: (rate) =>
    api.post('/demo/payment/fail-rate', { rate }),

  driverOutage: (on) =>
    api.post('/demo/driver/outage', { on }),

  silentDriver: (driverId, silent) =>
    api.post('/demo/matching/silent-driver', {
      driverId,
      silent
    }),

  notifications: (to) =>
    api.get('/demo/notifications', { params: { to } })
}

export default api
