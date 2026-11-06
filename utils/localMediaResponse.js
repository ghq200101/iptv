import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

// Local module responses can be small buffers/manifests or streaming MP4/media.
// Keep backpressure and release the upstream when the player disconnects.
export async function sendLocalMediaResponse(res, method, local) {
  const dispose = () => local.dispose?.()
  res.once('close', dispose)
  try {
    res.writeHead(local.status || 200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      ...(local.headers || {}),
    })
    if (method === 'HEAD') {
      await local.body?.cancel?.()
      res.end()
    } else if (typeof local.body?.getReader === 'function') {
      await pipeline(Readable.fromWeb(local.body), res)
    } else if (typeof local.body?.pipe === 'function') {
      await pipeline(local.body, res)
    } else res.end(local.body)
  } catch (error) { if (!res.destroyed) res.destroy(error) }
  finally { res.off('close', dispose); dispose() }
}
