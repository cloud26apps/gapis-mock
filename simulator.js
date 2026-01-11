#!/usr/bin/env node
import express from 'express'; import os from 'os'; import { uptime } from 'process';
import bytes from 'bytes'; import Dicer from 'dicer'; import compression from 'compression';
import { initRouterCache, mockDelays, argvMap, envMap, getVal, routeHandler, preloadRouters, getCacheStats, parseOptions } from './routerManager.js';
import { loadFile } from './loadData.js';

export const allServices = {}, proxyMap = {}, preloadList = [];
export const OPTS = {
  HOST: '0.0.0.0', PORT: 3333, // default host/port
  TIMEOUT_MS: 60000, // request/response timeout
  KEEPALIVE_TIMEOUT_MS: 30000, // keep-alive timeout
  SOCKET_TIMEOUT_MS: 60000, // socket timeout
  OLDCONN_PURGE: 600000, // purge old connections
  BODY_MAXSIZE: '1 GB', BODY_TRUNCATED: '1 MB', // body size limits for content parsers
  MAXDELAY_MS: 30000, // max artificial delay for mock delays
  LRU_MAXITEMS: 600, LRU_TTL_MINS: 10, LRU_AUTOPURGE_MINS: 5, // LRU cache options
  PRELOAD: "storage" // CSV list of services to preload in memory, refer documentation for valid service names to use
};

// Initialize router cache 
initRouterCache(OPTS);
// Create Express app
const app = express();
app.disable('x-powered-by'); app.disable('etag'); // disable unnecessary headers
app.set('trust proxy', false); // trust x-forwarded-* headers
app.set('json spaces', 1); app.set('case sensitive routing', true); app.set('strict routing', true); // express settings

// Compress responses for text-based content types only
app.use(compression({
  filter: (req, res) => {
    // Compress only if client accepts encoding
    if (req.headers['x-no-compression']) { return false; }
    // Check content-type for compressible types
    const ct = res.getHeader('Content-Type');
    if (ct && typeof ct === 'string') {
      const type = ct.split(';')[0].toLowerCase();
      // Compress text-based content types
      return type.includes('text/') || type.includes('json') || type.includes('xml') ||
        type.includes('javascript') || type.includes('html') || type.includes('css');
    }
    return compression.filter(req, res);
  },
  threshold: 1024, // Only compress if response > 1KB
  level: 6 // Compression level (0-9, 6 is default balance)
}));

// General middleware for timeouts, headers, and OPTIONS handling
app.use((req, res, next) => {
  // Reject overly long URLs
  if (req.url.length > 4096) {
    return res.status(414).json({
      error: { code: 414, message: 'URI Too Long (Max allowed: 4096)', status: 'INVALID_ARGUMENT' }
    });
  }
  // Set timeouts for request and response
  req.setTimeout(OPTS.TIMEOUT_MS, () => {
    if (!res.headersSent) {
      res.status(408).json({
        error: { code: 408, message: `Request timeout (${OPTS.TIMEOUT_MS} ms)`, status: 'REQUEST_TIMEOUT' }
      });
    }
    req.socket.destroy();
  });
  res.setTimeout(OPTS.TIMEOUT_MS, () => {
    if (!res.headersSent) {
      res.status(504).json({
        error: { code: 504, message: `Response timeout (${OPTS.TIMEOUT_MS} ms)`, status: 'GATEWAY_TIMEOUT' }
      });
    }
    req.socket.destroy();
  });
  // Set common headers
  res.set({
    'Connection': 'keep-alive', 'Keep-Alive': `timeout=${Math.ceil(OPTS.KEEPALIVE_TIMEOUT_MS / 1000)}, max=100`,
    // Security headers (helmet replacement)
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'X-XSS-Protection': '1; mode=block',
    // 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains', 'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Referrer-Policy': 'no-referrer',
    // CORS headers
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || 'Content-Type,Authorization',
  });

  // Handle OPTIONS preflight requests
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  //req.on('aborted', () => { console.log(`Client aborted request: ${req.method} ${req.url}`); });

  req.XMREQID = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  res.setHeader('XMREQID', req.XMREQID); // request identifier
  res.setHeader('XMSERVER', 'GAPIS-MOCK/1.0.1'); // server identifier
  next();
});

// various middlewares
app.use(parseOptions, rateLimits, contentParsers);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
});

// View stats and configuration 
app.get('/', (req, res) => {
  const mem = process.memoryUsage(), cpu = process.cpuUsage(), load = os.loadavg(), cached = getCacheStats();
  return res.json({
    info: 'Mock Server is running OK, check stats/config/details below. Time in milliseconds (*_MS) or minutes (*_MINS) etc.',
    config: OPTS,
    // os: {
    //   info: `hostname=${os.hostname()} type=${os.type()} machine=${os.machine()} platform=${os.platform()} arch=${os.arch()} release=${os.release()} version=${os.version()}`,
    //   cpus: os.cpus().length, uptimeHr: Math.round(os.uptime() / 60 / 60),
    //   totalMemMB: Math.round(os.totalmem() / 1024 / 1024), freeMemMB: Math.round(os.freemem() / 1024 / 1024),
    // },
    cached: cached,
    // activeConnections: startServer.activeConnections.size,
    // activeConnectionsList: Array.from(startServer.activeConnections).map(s => `${s.remoteAddress}:${s.remotePort} (${new Date(s._connectedAt).toLocaleString()})`).join(', ')
  });
});

// Helper function to convert buffer to string with truncation
function bufferToString(buffer, maxLength = 200) {
  if (!Buffer.isBuffer(buffer)) return buffer;
  return buffer.toString('utf8', 0, maxLength) + (buffer.length > maxLength ? '...[moredata]' : '');
  //return buffer.toString('latin1', 0, maxLength) + (buffer.length > maxLength ? '...[moredata]' : '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\xFF]/g, '.');
}

// testing parsed body & file uploads
app.post('/mockadmin/test', (req, res) => {
  let body = req.body;
  const ct = (req.headers['content-type'] || '').split(';')[0].toLowerCase();
  try { body = JSON.parse(body.toString('utf8')); }
  catch (e) { body = bufferToString(body, 20000); }
  if (req.files && Array.isArray(req.files)) {
    req.files.forEach(f => { f.buffer = bufferToString(f.buffer, 20000); });
  }
  return res.json({ body, files: req.files });
});

// special handling for Google Discovery APIs (api/version/rest)
app.get('/discovery/v1/apis/:api/:version/rest', async (req, res) => {
  const { api, version } = req.params;
  const service = `${api+version}`.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  if(!allServices[service]) {
    return res.status(404).json({
      error: {
        code: 404,
        message: `Unknown API/Version: ${api}/${version}. Check /discovery/v1/apis for list of supported APIs.`,
        status: 'NOT_FOUND',
      }
    });
  }
  const spec11 = JSON.parse(await loadFile(`data/${service}_r.json`, service));
  return res.json(spec11);
  // const url = `https://www.googleapis.com/discovery/v1/apis/${api}/${version}/rest`;
  // await passthruToGoogle(req, res, url, 'PASSTHROUGH: Failed to fetch discovery doc from Google');  
});
// special handling for Google Discovery APIs (list of apis)
app.get('/discovery/v1/apis', async (req, res) => {
  const spec11 = JSON.parse(await loadFile(`data/apisdir.json`, 'apis'));
  return res.json(spec11);
  // const url = 'https://www.googleapis.com/discovery/v1/apis';
  // await passthruToGoogle(req, res, url, 'PASSTHROUGH: Failed to fetch discovery list from Google');
});

// middlewares for google apis
app.use(googleParser, mockDelays, routeHandler);

// 404 handler
app.use((req, res) => {
  return res.status(404).json({
    error: {
      code: 404,
      message: 'Unknown Host/Service/API, Requested URL not found. If you are accessing this mock simulator using rootURL override/direct access, set req.headers.xmservice = servicename; if using proxy/DNS override, check req.headers.host or req.headers.x-forwarded-host or req.headers.x-original-host to match service domain like xxx.googleapis.com where xxx = servicename',
      status: 'NOT_FOUND',
      errors: [{
        method: req.method, url: req.originalUrl, 'req.headers[xmservice]': req.headers['xmservice']+'',
        'req.headers[host]': req.headers['host']+'', 'req.headers[x-forwarded-host]': req.headers['x-forwarded-host']+'',
        'req.headers[x-original-host]': req.headers['x-original-host']+''
      }],
    }
  });
});

// call next(err) from any middleware to trigger this
app.use((err, req, res, next) => {
  if (err.type === 'bad_request') {
    return res.status(400).json({
      error: { code: 400, message: err.message, status: 'INVALID_REQUEST_DATA' }
    });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      error: {
        code: 413,
        message: 'Payload Too Large. Check OPTS.BODY_MAXSIZE & OPTS.BODY_TRUNCATED to increase the limits.',
        status: 'PAYLOAD_TOO_LARGE',
        errors: [{
          originalError: err.message,
          sizeLimit: OPTS.BODY_MAXSIZE,
          contentSize: req.headers['content-length'] || 'unknown'
        }]
      }
    });
  }
  return res.status(500).json({
    error: {
      code: 500,
      message: `Server Error. Please try again later.`,
      status: 'INTERNAL',
      errors: [{ error: err.message, stack: err.stack }],
    }
  });
});

// Function to start server with port retry logic
async function startServer() {
  console.log(`Starting Mock server...Please wait...`);

  // track active connections, cleanup old connections
  if (!startServer.activeConnections) {
    startServer.activeConnections = new Set();
    startServer.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const socket of startServer.activeConnections) {
        if (now - socket._connectedAt > OPTS.OLDCONN_PURGE) {
          socket.destroy();
        }
      }
    }, OPTS.OLDCONN_PURGE);
  }

  // const servicesData = JSON.parse(fs.readFileSync(new URL('./serviceslist.json', import.meta.url), 'utf-8'));
  const servicesData = JSON.parse(await loadFile('data/serviceslist.json'));
  Object.assign(allServices, servicesData.allServices);
  Object.assign(proxyMap, servicesData.proxyMap);

  let host = getVal(null, argvMap, envMap, 'xmhost', OPTS.HOST);
  let port = getVal(null, argvMap, envMap, 'xmport', OPTS.PORT);
  const server = app.listen(port, host);

  server.on('listening', async () => {
    const addr = server.address();
    OPTS.HOST = addr.address; OPTS.PORT = addr.port;

    // preload routers for specified services, including any aliases (alias has $ref to main service)
    let servicesToPreload = getVal(null, argvMap, envMap, 'xmpreload', OPTS.PRELOAD)
      .split(',').map(s => s.trim()).filter(Boolean);
    servicesToPreload.forEach(svc => {
      if (allServices[svc]?.ref) preloadList.push(allServices[svc].ref);
      else if (allServices[svc]) preloadList.push(svc);
    });
    await preloadRouters(preloadList);

    // Determine actual IP addresses for display
    let displayUrls = [];
    // If bound to all interfaces, list all non-internal addresses
    if (addr.address === '0.0.0.0' || addr.address === '::') {
      OPTS.HOST = '127.0.0.1'; OPTS.PORT = addr.port;
      // Get all network interfaces
      const interfaces = os.networkInterfaces();
      displayUrls.push(`http://localhost:${addr.port}`, `http://127.0.0.1:${addr.port}`); // Start with localhost
      // Collect only IPv4 addresses
      for (const name in interfaces) {
        for (const iface of interfaces[name]) {
          if (!iface.internal && iface.family==='IPv4') {
            displayUrls.push(`http://${iface.address}:${addr.port}`); // ${JSON.stringify(iface)} interface-details
          }
        }
      }
      // Construct display URLs
      displayUrls.push('Skipping IPv6 addresses for display, avoid using IPv6 addresses.');
      displayUrls.push(`IMPORTANT NOTE - If using Docker/container, access the server using the host machine's IP address/hostname/port based on "docker run -p/docker compose" settings.`);
    } else {
      // Use the specific bound address
      const displayHost = addr.family === 'IPv6' ? `[${addr.address}]` : addr.address;
      displayUrls = [`http://${displayHost}:${addr.port}`];
    }
    // Display startup info
    console.log(`Mock Server running. Access at:`);
    displayUrls.forEach(url => console.log(`  ${url}`));
    console.log(`Press Ctrl+C to stop the server & exit.`);
  }); // listening
  // Handle new connections for socket timeout, track old connections for cleanup
  server.on('connection', (socket) => {
    socket._connectedAt = Date.now();
    startServer.activeConnections.add(socket);
    // Destroy socket after idle timeout
    socket.setTimeout(OPTS.SOCKET_TIMEOUT_MS);
    socket.on('timeout', () => { socket.destroy(); }); // on timeout destroy socket
    socket.on('close', () => { startServer.activeConnections.delete(socket); }); // remove on close
  });
  // Handle server errors
  server.on('error', (err) => {
    console.log(`ERROR: Server failed: ${err.code} / ${err.message} / ${JSON.stringify(err)}`);
    process.exit(1);
  });

  server.timeout = OPTS.SOCKET_TIMEOUT_MS;
  server.keepAliveTimeout = OPTS.KEEPALIVE_TIMEOUT_MS;
  server.headersTimeout = OPTS.TIMEOUT_MS;
  server.requestTimeout = OPTS.TIMEOUT_MS;

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server gracefully...');
    if (rateLimits.cleanupInterval) {
      clearInterval(rateLimits.cleanupInterval);
    }
    // Force close all active sockets
    for (const socket of startServer.activeConnections) {
      socket.destroy();
    }
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('SIGINT received, closing server gracefully...');
    if (rateLimits.cleanupInterval) {
      clearInterval(rateLimits.cleanupInterval);
    }
    // Force close all active sockets
    for (const socket of startServer.activeConnections) {
      socket.destroy();
    }
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });

  return server;
} // startServer

startServer();

// content parsers middleware
async function contentParsers(req, res, next) {
  const bodyLimit = Number(bytes.parse(OPTS.BODY_MAXSIZE + ''));
  const bodyTruncated = Number(bytes.parse(OPTS.BODY_TRUNCATED + ''));

  const uploadType = (req.query.uploadType || req.query.upload_protocol || '').toLowerCase();
  const ct = (req.headers['content-type'] || '').split(';')[0].toLowerCase();
  // If body already parsed, skip
  if (req.body !== undefined) return next();

  // Early Content-Length limit
  const cl = req.headers['content-length'];
  if (cl) {
    const clen = Number(cl);
    if (!Number.isNaN(clen) && clen > bodyLimit) {
      const err = new Error(`Content-Length ${clen} exceeds limit ${bodyLimit}`);
      err.type = 'entity.too.large';
      return next(err);
    }
  }

  // Add cleanup handler for request stream
  let streamConsumed = false;
  const cleanupStream = () => {
    if (!streamConsumed) {
      streamConsumed = true;
      req.removeAllListeners('data');
      req.removeAllListeners('end');
      req.removeAllListeners('error');
      req.resume(); // Drain any remaining data
    }
  };

  // Add error handler for request stream
  req.once('error', (err) => {
    cleanupStream();
    if (!res.headersSent) {
      next(err);
    }
  });

  // Helper to accumulate raw body (for media uploads or binary types)
  async function collectRaw() {
    const chunks = []; let size = 0;
    try {
      for await (const chunk of req) {
        if (size + chunk.length > bodyLimit) {
          cleanupStream();
          const err = new Error(`Body size ${size + chunk.length} exceeds limit ${bodyLimit}`);
          err.type = 'entity.too.large';
          throw err;
        }
        if (size < bodyTruncated) chunks.push(chunk);
        size += chunk.length;
      }
      streamConsumed = true;
      if (size > bodyTruncated) {
        console.log(`[WARN] Request body truncated to ${bodyTruncated} bytes (actual: ${size}). Check OPTS.BODY_TRUNCATED & OPTS.BODY_MAXSIZE to increase the limits.`);
      }
      return Buffer.concat(chunks, size > bodyTruncated ? bodyTruncated : size);
    } catch (err) {
      cleanupStream();
      throw err;
    }
  } // collectRaw

  if (uploadType === 'media' || uploadType === 'raw') {
    try {
      const buf = await collectRaw();
      req.rawBody = buf;
      req.body = buf; // Buffer
      return next();
    } catch (e) {
      cleanupStream();
      return next(e);
    }
  } // media/raw

  // handle resumable uploads
  if (uploadType === 'resumable') {
    // If JSON-like, parse JSON; else keep Buffer
    try {
      const buf = await collectRaw();
      req.rawBody = buf;
      const looksJson = ct.includes('application/json') || ct.endsWith('+json');
      req.body = looksJson ? (() => { try { return JSON.parse(buf.toString('utf8')); } catch { return buf; } })() : buf;
      return next();
    } catch (e) {
      cleanupStream();
      return next(e);
    }
  } // resumable

  // Any multipart/* (multipart/form-data, related, mixed, etc.)
  if (ct.startsWith('multipart/')) {

    let dicerCleanedUp = false;
    const cleanupDicer = (dicer) => {
      if (dicerCleanedUp) return;
      dicerCleanedUp = true;
      try {
        dicer.removeAllListeners();
        req.unpipe(dicer);
        req.removeAllListeners('data');
        req.removeAllListeners('end');
        req.removeAllListeners('error');
        req.resume(); // Drain remaining data
      } catch (err) {
        // Ignore cleanup errors
      }
    };

    try {
      const boundaryMatch = (req.headers['content-type'] || '').match(/boundary="?([^";]+)"?/i);
      if (!boundaryMatch) {
        const err = new Error(`Missing multipart boundary in content-type: ${req.headers['content-type']}`);
        err.type = "bad_request";
        return next(err);
      }
      const boundary = boundaryMatch[1];
      const dicer = new Dicer({ boundary });
      const parts = []; let total = 0; let aborted = false;
      let errorHandled = false;

      // Add timeout for hanging streams
      const timeout = setTimeout(() => {
        if (!aborted && !errorHandled) {
          aborted = true;
          errorHandled = true;
          cleanupDicer(dicer);
          // Try to send response if possible
          if (!res.headersSent) {
            res.status(408).json({
              error: { code: 408, message: 'Multipart parsing timeout', status: 'REQUEST_TIMEOUT' }
            });
          }
          // Then force close socket
          setImmediate(() => req.socket.destroy());
          // Next with error
          const err = new Error('Multipart parsing timeout');
          err.type = 'request.timeout';
          next(err);
        }
      }, OPTS.TIMEOUT_MS);

      // Handle request stream errors
      req.once('error', (err) => {
        clearTimeout(timeout);
        if (!errorHandled) {
          errorHandled = true;
          aborted = true;
          cleanupDicer(dicer);
          next(err);
        }
      });

      // Handle client disconnect
      req.once('aborted', () => {
        clearTimeout(timeout);
        if (!errorHandled) {
          errorHandled = true;
          aborted = true;
          cleanupDicer(dicer);
          const err = new Error('Client aborted multipart upload');
          err.type = 'request.aborted';
          next(err);
        }
      });

      // Handle each part
      dicer.on('part', (partStream) => {
        if (aborted) {
          partStream.resume(); // Drain and ignore
          return;
        }

        const headers = {}; const chunks = []; let partSize = 0;
        let partErrorHandled = false;

        // Capture MIME headers for this part
        partStream.on('header', (h) => {
          for (const k in h) {
            headers[k.toLowerCase()] = h[k].map(v => v.toString());
          }
        });
        // Accumulate part contents
        partStream.on('data', (buf) => {
          if (aborted || partErrorHandled) return;
          total += buf.length;
          if (total > bodyLimit && !aborted) {
            aborted = true;
            partErrorHandled = true;
            clearTimeout(timeout);
            cleanupDicer(dicer);
            const err = new Error(`Multipart size ${total} exceeds limit ${bodyLimit}`);
            err.type = "entity.too.large";
            if (!errorHandled) {
              errorHandled = true;
              next(err);
            }
            return;
            // dicer.emit('error', Object.assign(
            //   new Error(`Multipart size ${total} exceeds bodylimit ${bodyLimit}`), { type: "entity.too.large" }
            // ));
          }
          if (partSize < bodyTruncated) chunks.push(buf);
          partSize += buf.length;
        }); // data

        // Handle part stream errors
        partStream.once('error', (err) => {
          if (!partErrorHandled) {
            partErrorHandled = true;
            aborted = true;
            clearTimeout(timeout);
            cleanupDicer(dicer);
            if (!errorHandled) {
              errorHandled = true;
              next(err);
            }
          }
        });

        // End of part
        partStream.on('end', () => {
          if (aborted || partErrorHandled) return;

          const buffer = Buffer.concat(chunks, partSize > bodyTruncated ? bodyTruncated : partSize);
          parts.push({
            headers, buffer, size: buffer.length,
            mimeType: headers['content-type'] ? headers['content-type'][0] : null,
            disposition: headers['content-disposition'] ? headers['content-disposition'][0] : null,
            truncated: partSize > bodyTruncated // indicate if truncated
          });
        }); // end of partStream
      }); // end of dicer.on('part')

      dicer.on('error', (err) => {
        clearTimeout(timeout);
        if (!errorHandled) {
          errorHandled = true;
          aborted = true;
          cleanupDicer(dicer);
          next(err);
        }
      });

      dicer.on('finish', () => {
        clearTimeout(timeout);
        if (aborted || errorHandled) return;
        cleanupDicer(dicer);
        // Default body + files extraction  
        req.files = []; req.body = {};
        // === Normalize for different multipart types ===
        if (ct.includes('multipart/form-data')) {
          // Form-data: extract fields + files
          for (const p of parts) {
            const disp = p.disposition || "";
            if (disp.includes('form-data')) {
              const nameMatch = disp.match(/name="([^"]+)"/);
              const name = nameMatch ? nameMatch[1] : null;
              const filenameMatch = disp.match(/filename="([^"]+)"/);
              const filename = filenameMatch ? filenameMatch[1] : null;
              // If filename present, it's a file upload, else a form field
              if (filename) {
                req.files.push({
                  fieldname: name, filename,
                  headers: p.headers, buffer: p.buffer, size: p.size,
                  mimeType: p.mimeType, truncated: p.truncated,
                });
              } else if (name) {
                req.body[name] = p.buffer.toString('utf8');
                // Handle potential UTF-8 decode errors
                try {
                  req.body[name] = p.buffer.toString('utf8');
                } catch (err) {
                  req.body[name] = p.buffer.toString('latin1');
                }
              }
            } // if disposition includes form-data
          } // for parts
        } else {
          // multipart/related or multipart/mixed (Google)
          // First JSON part → metadata
          if (parts.length > 0 && (parts[0].mimeType || "").includes("json")) {
            try {
              req.body = JSON.parse(parts[0].buffer.toString("utf8")); // parse JSON metadata
            } catch {
              req.body = parts[0].buffer.toString("utf8"); // fallback to raw text
            }
            req.files = parts.slice(1);
          } else {
            // Fallback — send all parts as files
            req.body = {};
            req.files = parts;
          }
        } // normalize multipart types

        req.rawBody = null; // multipart handled
        next();
      }); // dicer finish
      // Pipe request to dicer
      req.pipe(dicer);
      return;
    } catch (e) {
      return next(e);
    }
  } // multipart

  // Non-multipart regular request:
  // Decide parser order: JSON -> urlencoded -> text -> raw (binary)
  // We manually read once; then branch.
  try {
    const buf = await collectRaw();
    req.rawBody = buf;

    if (buf.length === 0) { req.body = {}; return next(); }

    if (ct.includes('application/json') || ct.endsWith('+json')) {
      try { req.body = JSON.parse(buf.toString('utf8')); return next(); }
      catch { req.body = buf.toString('utf8'); return next(); }
    }

    if (ct === 'application/x-www-form-urlencoded') {
      const qs = new URLSearchParams(buf.toString('utf8'));
      const obj = {}; for (const [k, v] of qs.entries()) obj[k] = v;
      req.body = obj; return next();
    }

    if (ct.startsWith('text/') || ct === 'application/xml') {
      req.body = buf.toString('utf8'); return next();
    }

    req.body = buf; return next();
  } catch (e) {
    cleanupStream();
    return next(e);
  }
} // contentParsers

// Google parser middleware to determine service from hostname or host header
function googleParser(req, res, next) {
  // console.log({ headers: req.headers, method: req.method, url: req.originalUrl });
  
  const setServiceFromHost = (host) => {
    let svc1 = (host.split(':')[0] || '-').split('.')[0].toLowerCase().trim(); // first part of host
    if (allServices[svc1]?.ref) { req.XMSERVICE = allServices[svc1].ref; }
    else if (allServices[svc1]) { req.XMSERVICE = svc1; }
  };

  // proxyMap[url] = Array of "svc@@version@@path@@region" entries to extract service
  const setServiceFromProxyMap = (url) => {
    // single service for host
    if (proxyMap[url] && proxyMap[url].length === 1) {
      [req.XMSERVICE, , , req.XMREGION] = proxyMap[url][0].split('@@');
    }
    // multiple services for same host - need to match path prefix
    else if (proxyMap[url] && proxyMap[url].length > 1) {
      // find matching path prefix, first match wins 
      for (const item of proxyMap[url]) {
        const pathPrefix = item.split('@@')[2];
        if (req.path.startsWith(pathPrefix)) {
          [req.XMSERVICE, , , req.XMREGION] = item.split('@@');
          break;
        }
      }
    }
  };
  // Check various host sources to extract service, in priority order
  const hostSources = [req.headers['xmservice'], req.headers['x-forwarded-host'], req.headers['x-original-host'], req.headers['host'], req.hostname];
  for (let host of hostSources) {
    if (host && host.endsWith('.googleapis.com')) {
      let url = host.replace('.mtls.googleapis.com', '').replace('.googleapis.com', '').trim();
      setServiceFromProxyMap(url);
      if (req.XMSERVICE) return next(); // found
    }
    else if (host) {
      setServiceFromHost(host);
      if (req.XMSERVICE) return next(); // found
    }
  }
  const local = JSON.stringify(req.socket?.address());
  const remote = `${req.socket?.remoteAddress}/${req.socket?.remotePort}/${req.socket?.remoteFamily}`;
  next();
} // googleParser

// Rate limiting middleware using token bucket algorithm
function rateLimits(req, res, next) {
  const RATELIMIT_WINDOW_MS = 60000, RATELIMIT_MAX_REQUESTS = 100000,
    RATELIMIT_AUTOCLEAN_MS = 300000, RATELIMIT_STALE_MS = 300000;

  // Skip rate limiting if disabled
  if (RATELIMIT_MAX_REQUESTS === 0) return next();
  // Get client identifier - check multiple headers in priority order
  const clientId =
    // req.headers['cf-connecting-ip'] ||        // Cloudflare
    // req.headers['x-real-ip'] ||               // nginx/Apache
    // req.headers['x-forwarded-for']?.split(',')[0]?.trim() || // Standard proxy header (first IP)
    // req.headers['x-client-ip'] ||             // Custom header
    // req.headers['true-client-ip'] ||          // Akamai/Cloudflare Enterprise
    req.socket.remoteAddress ||               // socket remote address
    req.ip ||                                 // Express req.ip (works with trust proxy)
    'unknown';
  // Initialize rate limit store if not exists & cleanup old entries
  if (!rateLimits.store) {
    rateLimits.store = new Map();
    // Start cleanup interval - attached to function object
    rateLimits.cleanupInterval = setInterval(() => {
      if (rateLimits.store) {
        const now = Date.now();
        for (const [clientId, bucket] of rateLimits.store.entries()) {
          // If no activity for time, delete entry
          if (now - bucket.lastRefill > RATELIMIT_STALE_MS) {
            rateLimits.store.delete(clientId);
          }
        }
      }
    }, RATELIMIT_AUTOCLEAN_MS);
  } // end init store
  const now = Date.now();
  const windowMs = RATELIMIT_WINDOW_MS; // window
  const maxRequests = RATELIMIT_MAX_REQUESTS; // max requests per window
  // Get or create client bucket
  let bucket = rateLimits.store.get(clientId);
  if (!bucket) {
    bucket = { tokens: maxRequests, lastRefill: now };
    rateLimits.store.set(clientId, bucket);
  }
  // Refill tokens based on time elapsed
  const elapsed = now - bucket.lastRefill;
  if (elapsed >= windowMs) {
    bucket.tokens = maxRequests;
    bucket.lastRefill = now;
  }
  // Check if request allowed
  if (bucket.tokens > 0) {
    bucket.tokens--;
    // res.setHeader('XM-RateLimit-Limit', maxRequests);
    // res.setHeader('XM-RateLimit-Remaining', bucket.tokens);
    // res.setHeader('XM-RateLimit-Reset', new Date(bucket.lastRefill + windowMs).toISOString());
    return next();
  }
  // Rate limit exceeded
  const retryAfter = Math.ceil((bucket.lastRefill + windowMs - now) / 1000);
  // res.setHeader('XM-RateLimit-Retry-After', retryAfter);
  // res.setHeader('XM-RateLimit-Limit', maxRequests);
  // res.setHeader('XM-RateLimit-Remaining', 0);
  // Respond with 429 Too Many Requests
  return res.status(429).json({
    error: {
      code: 429,
      message: `Rate limit exceeded for this Mock Server. Too many requests. Please try again later after ${windowMs / 1000} seconds (${retryAfter}). Current Limit = ${maxRequests} requests per ${windowMs / 1000} seconds.`,
      status: 'RESOURCE_EXHAUSTED',
      errors: [{
        retryAfter: `${retryAfter} seconds`,
        currentLimit: `${maxRequests} requests per ${windowMs / 1000} seconds`,
        clientId: clientId
      }]
    }
  });
} // rateLimits

// Common passthru handler
async function passthruToGoogle(req, res, url, errmsg) {
  try {
    const response = await fetch(url, { method: 'GET' });
  // "rootUrl": "https://storage.googleapis.com/",
  // "mtlsRootUrl": "https://storage.mtls.googleapis.com/",
  // "baseUrl": "https://storage.googleapis.com/storage/v1/",
  // "endpoints": [{"endpointUrl": "https://storage.africa-south1.rep.googleapis.com/"}]
  // replace with mock server host/port if needed
    const body = await response.text();
    res.status(response.status);
    res.set('content-type', response.headers.get('content-type') || 'application/json');
    res.send(body);
  } catch (err) {
    res.status(502).json({
      error: {
        code: 502,
        message: `${errmsg}: ${err.message}`,
        status: 'BAD_GATEWAY'
      }
    });
  }
}
