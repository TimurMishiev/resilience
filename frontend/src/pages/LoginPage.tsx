import { useState } from 'react'
import { Button, Callout, FormGroup, InputGroup, Intent } from '@blueprintjs/core'
import { login } from '../api/auth'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'

export default function LoginPage() {
  const { login: setUser } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const { user } = await login(email.trim(), password)
      setUser(user)
      navigate('/sites', { replace: true })
    } catch {
      setError('Invalid email or password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card bp6-dark">
        <div className="login-header">
          <span className="login-brand">RESILIENCE</span>
          <span className="login-tagline bp6-text-muted">Mission Operations Console</span>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <FormGroup label="Email" labelFor="email">
            <InputGroup
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              placeholder="operator@resilience.mil"
              autoFocus
              autoComplete="username"
              large
            />
          </FormGroup>

          <FormGroup label="Password" labelFor="password">
            <InputGroup
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              placeholder="Password"
              autoComplete="current-password"
              large
            />
          </FormGroup>

          {error && (
            <Callout intent={Intent.DANGER} compact className="login-error">
              {error}
            </Callout>
          )}

          <Button
            type="submit"
            intent={Intent.PRIMARY}
            loading={loading}
            disabled={!email || !password}
            fill
            large
            text="Sign in"
            className="login-submit"
          />
        </form>
      </div>
    </div>
  )
}
