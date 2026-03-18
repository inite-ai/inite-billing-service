import axios from 'axios'
import { getAccessToken, storeTokens, clearTokens } from './auth-helper'
import { isJWTExpired } from './pkce'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

api.interceptors.request.use(async (config) => {
  let token = getAccessToken()

  if (token && isJWTExpired(token)) {
    // Try to refresh
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      })
      if (response.ok) {
        const tokens = await response.json()
        storeTokens(tokens.access_token, tokens.id_token)
        token = tokens.access_token
      } else if (response.status === 401) {
        clearTokens()
        token = null
      }
    } catch {
      // Refresh failed, continue without token
    }
  }

  if (token) {
    config.headers.Authorization = `Bearer ${token}`
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
          const tokens = await response.json()
          storeTokens(tokens.access_token, tokens.id_token)
          originalRequest.headers.Authorization = `Bearer ${tokens.access_token}`
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
