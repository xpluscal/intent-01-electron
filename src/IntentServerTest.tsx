import { useState, useEffect } from 'react'

declare global {
  interface Window {
    intentAPI: {
      getServerStatus: () => Promise<{ running: boolean; port: number | null }>
      serverUrl: string
    }
  }
}

export function IntentServerTest() {
  const [serverStatus, setServerStatus] = useState<{ running: boolean; port: number | null } | null>(null)
  const [healthCheck, setHealthCheck] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    checkServerStatus()
  }, [])

  const checkServerStatus = async () => {
    try {
      const status = await window.intentAPI.getServerStatus()
      setServerStatus(status)
    } catch (err) {
      console.error('Failed to get server status:', err)
      setError('Failed to get server status')
    }
  }

  const testHealthEndpoint = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`${window.intentAPI.serverUrl}/health`)
      const data = await response.json()
      setHealthCheck(data)
    } catch (err) {
      console.error('Health check failed:', err)
      setError('Health check failed: ' + (err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const testExecute = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`${window.intentAPI.serverUrl}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent: 'claude',
          prompt: 'Say hello world'
        })
      })
      const data = await response.json()
      console.log('Execute response:', data)
      alert(`Execution started with ID: ${data.executionId}`)
    } catch (err) {
      console.error('Execute failed:', err)
      setError('Execute failed: ' + (err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '20px', border: '1px solid #ccc', borderRadius: '8px', margin: '20px' }}>
      <h2>Intent Server Integration Test</h2>
      
      <div style={{ marginBottom: '10px' }}>
        <strong>Server Status:</strong>{' '}
        {serverStatus ? (
          serverStatus.running ? (
            <span style={{ color: 'green' }}>Running on port {serverStatus.port}</span>
          ) : (
            <span style={{ color: 'red' }}>Not running</span>
          )
        ) : (
          'Checking...'
        )}
      </div>

      <div style={{ marginBottom: '10px' }}>
        <button onClick={checkServerStatus} disabled={loading}>
          Refresh Status
        </button>
        {' '}
        <button onClick={testHealthEndpoint} disabled={loading || !serverStatus?.running}>
          Test Health Endpoint
        </button>
        {' '}
        <button onClick={testExecute} disabled={loading || !serverStatus?.running}>
          Test Execute
        </button>
      </div>

      {healthCheck && (
        <div style={{ marginTop: '10px', padding: '10px', backgroundColor: '#f0f0f0', borderRadius: '4px' }}>
          <strong>Health Check Result:</strong>
          <pre>{JSON.stringify(healthCheck, null, 2)}</pre>
        </div>
      )}

      {error && (
        <div style={{ marginTop: '10px', color: 'red' }}>
          Error: {error}
        </div>
      )}

      {loading && <div>Loading...</div>}
    </div>
  )
}