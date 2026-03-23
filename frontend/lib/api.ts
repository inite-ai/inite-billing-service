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
        window.location.href = '/login'
      }
    }

    return Promise.reject(error)
  },
)

export default api
