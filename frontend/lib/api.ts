import axios from 'axios'
import { clearTokens, storeIdToken } from './auth-helper'
import { API_URL } from './config'

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  // Send httpOnly cookies (access_token) with every request
  withCredentials: true,
})

// Backend captures this into UserContact for localized emails/notifications
api.interceptors.request.use((config) => {
  if (typeof document !== 'undefined') {
    const locale = document.cookie.match(/(?:^|;\s*)locale=(\w+)/)?.[1]
    if (locale) config.headers['X-User-Locale'] = locale
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true

      try {
        const response = await fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'include',
        })

        if (response.ok) {
          const data = await response.json()
          if (data.id_token) {
            storeIdToken(data.id_token)
          }
          return api(originalRequest)
        }
      } catch {
        // Refresh failed
      }

      clearTokens()
      if (typeof window !== 'undefined') {
        // A hard navigation on purpose: the session is gone and every piece of
        // state fetched under it should go with it. This runs inside an axios
        // interceptor, where there is no router to push with anyway.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = '/login'
      }
    }

    return Promise.reject(error)
  },
)

export default api
