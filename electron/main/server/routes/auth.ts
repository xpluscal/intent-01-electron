import express from 'express'

const router = express.Router()

// Auth callback endpoint for development
router.get('/auth/callback', async (req, res) => {
  const { token } = req.query
  
  if (!token || typeof token !== 'string') {
    return res.status(400).send(`
      <html>
        <body>
          <h1>Authentication Error</h1>
          <p>No token provided</p>
        </body>
      </html>
    `)
  }
  
  try {
    // Get the main window from the server instance
    const server = req.app.locals.server
    if (server && server.mainWindow) {
      // Send token to the renderer process
      server.mainWindow.webContents.send('auth:token-received', token)
      
      // Return success page that auto-closes
      return res.send(`
        <html>
          <head>
            <title>Authentication Successful</title>
            <style>
              body {
                font-family: system-ui, -apple-system, sans-serif;
                display: flex;
                align-items: center;
                justify-content: center;
                height: 100vh;
                margin: 0;
                background: #000;
                color: #fff;
              }
              .container {
                text-align: center;
              }
              h1 {
                font-size: 2rem;
                margin-bottom: 1rem;
              }
              p {
                color: #999;
                margin-bottom: 2rem;
              }
              .spinner {
                border: 3px solid rgba(255,255,255,0.1);
                border-radius: 50%;
                border-top: 3px solid #fff;
                width: 40px;
                height: 40px;
                animation: spin 1s linear infinite;
                margin: 0 auto;
              }
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>✓ Authentication Successful</h1>
              <p>You can close this window</p>
              <div class="spinner"></div>
            </div>
            <script>
              // Try to close the window after a short delay
              setTimeout(() => {
                window.close()
              }, 2000)
            </script>
          </body>
        </html>
      `)
    } else {
      throw new Error('Main window not available')
    }
  } catch (error) {
    console.error('Auth callback error:', error)
    return res.status(500).send(`
      <html>
        <body>
          <h1>Authentication Error</h1>
          <p>Failed to process authentication. Please try again.</p>
        </body>
      </html>
    `)
  }
})

export default router