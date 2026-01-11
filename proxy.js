#!/usr/bin/env node
/**
 * Production-grade MITM proxy (single file) using mockttp (HTTP Toolkit's programmatic lib).
 * - Intercepts HTTP & HTTPS (MITM)
 * - Matches hosts ending with ".googleapis.com"
 * - Forwards matching requests to emulator at http://host:port preserving path/query/method/body
 * - Keeps original host in x-original-host header so emulator can do host-based routing if needed
 * - Sanitizes hop-by-hop headers
 * - Supports being used as system proxy (HTTP_PROXY/HTTPS_PROXY) or via DNS/hosts override (run proxy on port 443)
 */

import fs from 'fs'; import mockttp from 'mockttp';
import { fileURLToPath } from 'url';
import os from 'os';

function log(...args) {
    console.log(new Date().toLocaleString(), '[PROXY]', ...args);
}

// Create and start the mockttp proxy server
export async function mockProxy() {
    log('Starting local MITM proxy...');

    function getPort(varName, defaultPort) {
        const arg = process.argv.find(a => a.toLowerCase().startsWith(`--${varName.toLowerCase()}=`));
        const value = arg?.split('=')[1] ?? process.env[varName];
        if (value === undefined) return defaultPort;
        const port = Number(value);
        if (isNaN(port) || !Number.isInteger(port) || port <= 0 || port >= 65536) { console.error(`ERROR: Invalid port number for ${varName}: ${value}`); process.exit(1); }
        return port;
    }
    if (!mockProxy.XMPORT) { // proxy port        
        mockProxy.XMPORT = getPort('XMPORT', 3344);
    }
    if (!mockProxy.XMSIMHOST) { // simulator host
        mockProxy.XMSIMHOST = process.argv.find(a => a.toLowerCase().startsWith('--xmsimhost='))?.split('=')[1]
            || process.env.XMSIMHOST || '127.0.0.1';
    }
    if (!mockProxy.XMSIMPORT) { // simulator port
        mockProxy.XMSIMPORT = getPort('XMSIMPORT', 3333);
    }

    const KEYPATH = fileURLToPath(new URL('./proxy-root-ca.key', import.meta.url)); // private key path
    const CERTPATH = fileURLToPath(new URL('./proxy-root-ca.crt', import.meta.url)); // cert path
    // Generate a CA certificate for MITM (or load existing from files)
    if (!fs.existsSync(KEYPATH) || !fs.existsSync(CERTPATH)) {
        const ca = await mockttp.generateCACertificate({
            subject: {
                commonName: 'Mock Simulator CA',
                countryName: 'Mock Simulator CA',
                organizationName: 'Mock Simulator CA',
                organizationalUnitName: 'Mock Simulator CA',
            },
        });
        // Save the key and cert to files (PEM format, text mode)
        fs.writeFileSync(KEYPATH, ca.key, 'utf8'); // private key
        fs.writeFileSync(CERTPATH, ca.cert, 'utf8'); // certificate
    }

    // Create local mockttp instance with defaults
    const proxy = mockttp.getLocal({
        debug: false, cors: true,  
        recordTraffic: false, socks: false, suggestChanges: false, 
        https: { keyPath: KEYPATH, certPath: CERTPATH },
    });

    // Start in proxy mode (handles both HTTP & HTTPS via MITM)
    await proxy.start(mockProxy.XMPORT);
    mockProxy.XMPORT = proxy.port;

    // allow only localhost clients
    // await proxy.forAnyRequest()
    //     .matching(req => {
    //         // allow requests from local
    //         let ip = (req.remoteIpAddress + '').toLowerCase();
    //         ip = ip.startsWith("::ffff:") ? ip.slice(7) : ip; // Normalize IPv4-mapped IPv6 addresses
    //         log(`Checking client IP for access: ${ip}`);
    //         // ipv4
    //         if (ip.split(".").length === 4) {
    //             let parts = ip.split(".").map(x => parseInt(x, 10));
    //             if (parts[0] === 127 || parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) ||
    //                 (parts[0] === 172 && (parts[1] >= 16 && parts[1] <= 31)) ||
    //                 (parts[0] === 169 && parts[1] === 254)
    //              )
    //                 return false; // allow local
    //         }
    //         // ipv6
    //         if (ip === '::1' || ip.startsWith('fe80') || ip.startsWith('fc') || ip.startsWith('fd'))
    //             return false; // allow local
    //         return true; // block non-local
    //     })
    //     .thenReply(403, "Access denied: only local clients are allowed.");

    // Forward requests matching *.googleapis.com to the emulator
    await proxy.forAnyRequest()
        .matching(req => {
            const hostHeader = (req.headers?.host || req.headers?.Host || '').toLowerCase();
            const hostname = (hostHeader.split(':')[0] || '').toLowerCase();
            // log(`Checking host for forwarding: ${hostname}`);
            return hostname && hostname.endsWith('.googleapis.com');
        })
        .thenPassThrough({
            beforeRequest: (req) => {
                // We manually handle the headers here instead
                const headers = { ...req.headers };
                // Set the x-original-host header dynamically
                headers['x-original-host'] = headers.host || headers.Host || '';
                // Remove hop-by-hop headers as per RFC 2616 Section 13.5.1   
                const hopByHopHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade'];                
                hopByHopHeaders.forEach(h => { delete headers[h]; delete headers[h.charAt(0).toUpperCase() + h.slice(1)]; });
                headers['host'] = `${mockProxy.XMSIMHOST}:${mockProxy.XMSIMPORT}`;
                // log(`Forwarding request for host ${headers['x-original-host']} to mock simulator at http://${mockProxy.XMSIMHOST}:${mockProxy.XMSIMPORT}`);
                return {
                    headers,
                    url: `http://${mockProxy.XMSIMHOST}:${mockProxy.XMSIMPORT}${req.path}`
                };
            }
        });

    // Healthcheck endpoint
    await proxy.forGet('/health')
        .thenReply(200, 'OK');        

    // Provide endpoint to download the proxy CA certificate
    await proxy.forGet('/download-proxy-ca-cert')
        .thenReply(200, fs.readFileSync(CERTPATH, 'utf8'), {
            'Content-Type': 'plain/text',
            'Content-Disposition': 'attachment; filename="mock-simulator-proxy-root-ca.crt"'
        });

    // Handle requests to the proxy itself (not proxied requests)
    await proxy.forAnyRequest()
        .matching(req => {
            // Get host header (case-insensitive)
            const hostHeader = (req.headers?.host || req.headers?.Host || '').toLowerCase();
            const hostname = (hostHeader.split(':')[0] || '').toLowerCase();
            // log(`Checking for proxy info page: ${hostHeader} ${JSON.stringify(req.destination || {})}`);
            // Check if hostHeader matches the proxy's own host:port
            return (req.destination.port === mockProxy.XMPORT && !hostname.endsWith('.googleapis.com'));
        })
        .thenReply(
            200,
            `This is a local MITM proxy running on port ${mockProxy.XMPORT}. 
To use this proxy, set your client/lib/SDK/browser/backend's environment variables like HTTP_PROXY HTTPS_PROXY (etc) to http://localhost:${mockProxy.XMPORT} OR configure your system/browser to use it as a proxy.
Requests to *.googleapis.com will be forwarded to mock simulator.
Disable SSL/TLS verification checks in your client/lib/SDK/browser/backend to avoid certificate errors (self-signed cert).
All other requests will be transparently proxied as-is.
To implement custom behavior, modify proxy.js code OR please contact us for premium access/support/customizations.
If you see this page, you are visiting the proxy directly, which is not how proxies are normally used.`
        );

    // Set unmatched requests to passthrough by default
    await proxy.forUnmatchedRequest().thenPassThrough({ ignoreHostHttpsErrors: true, beforeRequest: (req) => { 
        // log(`Passthrough request for host ${req.headers.host || req.headers.Host || ''}`);
    } });

    // Display accessible URLs for the proxy
    function displayUrls() {
        const displayUrls = [];
        const port = mockProxy.XMPORT;
        const interfaces = os.networkInterfaces();
        displayUrls.push(`http://localhost:${port}`, `http://127.0.0.1:${port}`);
        for (const name in interfaces) {
            for (const iface of interfaces[name]) {
                if (!iface.internal && iface.family === 'IPv4') {
                    displayUrls.push(`http://${iface.address}:${port}`);
                }
            }
        }
        displayUrls.push('Skipping IPv6 addresses for display, avoid using IPv6 addresses.');
        displayUrls.push(`IMPORTANT NOTE - If using Docker/container, access the proxy using the host machine's IP address/hostname/port based on "docker run -p / docker compose" settings.`);
        log('Proxy running. Access at:');
        displayUrls.forEach(u => log('  ' + u));
    }

    log('Local MITM proxy server started on port ', mockProxy.XMPORT);
    // log(proxy.proxyEnv, proxy.url);
    displayUrls();
    log(`Download URL for Proxy Root CA cert: http://localhost:${mockProxy.XMPORT}/download-proxy-ca-cert`);
    log(`Make sure to install the CA certificate in your system/browser trusted root CA store to avoid SSL/TLS errors OR disable SSL/TLS verification checks to avoid certificate errors (due to self-signed cert).`);
    log(`Proxy will forward hosts matching *.googleapis.com to mock simulator.`);
    log(`Set environment variables HTTP_PROXY HTTPS_PROXY etc to http://localhost:${mockProxy.XMPORT} OR configure your system/browser to use it as a proxy.`);

    // proxy.getMockedEndpoints().then(endpoints => {
    //     log(`Currently mocked endpoints count: ${endpoints.length} ${JSON.stringify(endpoints,null,2)}`);
    // });

    // when any request arrives (HTTP or HTTPS via MITM), this handler runs
    proxy.on('request', (req) => {
        // log('Proxy REQUEST : ', req.method, req.headers.host || req.headers.Host || '');
    });

    // error handling
    proxy.on('error', (err) => {
        log('Proxy ERROR : ', err && err.stack ? err.stack : err);
    });

    // graceful shutdown handlers
    function shutdown(signal) {
        log('Shutting down proxy (signal=' + signal + ')');
        proxy.stop().then(() => {
            log('Proxy stopped.');
            process.exit(0);
        }).catch((err) => {
            log('Error stopping proxy:', err && err.stack ? err.stack : err);
            process.exit(1);
        });
        // force exit in 5s
        setTimeout(() => process.exit(1), 5000).unref();
    }
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
} // mockProxy

// Run
mockProxy().catch((err) => {
    log('Failed to start proxy:', err && err.stack ? err.stack : err);
    process.exit(1);
});
