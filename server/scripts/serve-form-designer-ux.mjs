// Local acceptance only: same-origin production build + real isolated API.
import express from 'express'
import http from 'node:http'
import { resolve } from 'node:path'
const app = express()
const apiPort = Number(process.env.API_PORT || 4179)
app.use('/api', (req, res) => {
  const target = http.request({ host: '127.0.0.1', port: apiPort, path: `/api${req.url}`, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${apiPort}`, origin: `http://127.0.0.1:${apiPort}` } }, response => {
    res.writeHead(response.statusCode || 502, response.headers)
    response.pipe(res)
  })
  target.on('error', () => { if (!res.headersSent) res.status(502).send('Isolated API unavailable') })
  req.pipe(target)
})
const client = resolve(import.meta.dirname, '../../client/dist')
app.use(express.static(client))
app.get('*', (_, res) => res.sendFile(resolve(client, 'index.html')))
app.listen(Number(process.env.UI_PORT || 4180), '127.0.0.1', () => console.log('Isolated UX acceptance UI ready on 127.0.0.1:4180'))
