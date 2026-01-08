import { LRUCache } from 'lru-cache';
import Router from 'find-my-way'; 
import Ajv from 'ajv'; import addFormats from 'ajv-formats';
import { generateMockFromSchema } from './mockGenerator.js';
import { allServices, OPTS } from './simulator.js';
import { loadFile } from './loadData.js';

// CLI args map (lowercase keys and values, --key=value, --flag=true)
export const argvMap = (() => {
  // check for CLI run or node cmd run
  const args = process.argv[0]?.toLowerCase().includes('node') ? process.argv.slice(2) : process.argv.slice(1);
  const map = {}; for (const arg of args) { if (arg.startsWith('--')) { const [key, ...rest] = arg.slice(2).split('='); map[key.toLowerCase()] = (rest.length ? rest.join('=') : 'true').toLowerCase(); } } return map;
})();
// env vars map (lowercase keys and values)
export const envMap = Object.fromEntries(
  Object.entries(process.env).map(([k, v]) => [String(k).toLowerCase(), String(v ?? '').toLowerCase()])
);
// convert value helper, to convert numeric strings to numbers, match optional +/-, digits, optional fractional part (e.g. -123, +3.14, 0.5, 10.0)
function convertValue(v) {
  if (typeof v !== 'string') return v; const s = v.trim(); if (/^[+-]?(?:\d+)(?:\.\d+)?$/.test(s)) return Number(s); return s;
}
// helper to get value from req query, headers, cli args, env vars, or default (lowercase all keys & values)
export function getVal(req, argvMap, envMap, key, defaultValue) {
  const dv = (defaultValue + '').toLowerCase(), qk = key?.toLowerCase(); // in lowercase
  if (!qk) return convertValue(dv);
  try {
    const reqQuery = req?._lowerQuery || {}; const reqHeaders = req?._lowerHeaders || {};
    for (const src of [reqQuery, reqHeaders, argvMap, envMap]) { if (src?.[qk] != null) return convertValue(src[qk]); }
    return convertValue(dv);
  } catch (err) {
    // console.log(`ERROR: getting value for key "${key}"`, err);
    return convertValue(dv);
  }
}
// priority order = req.query > req.headers > CLI args > Environment variables > Defaults
export async function parseOptions(req, res, next) {
  // Cache lowercased maps once per request, handling arrays by taking the last value
  req._lowerQuery = Object.fromEntries(
    Object.entries(req.query || {}).map(([k, v]) => {
      const key = typeof k === 'string' ? k.toLowerCase() : k;
      let value = Array.isArray(v) ? v[v.length - 1] : v; value = typeof value === 'string' ? value.toLowerCase() : value;
      return [key, value];
    })
  );
  req._lowerHeaders = Object.fromEntries(
    Object.entries(req.headers || {}).map(([k, v]) => {
      const key = typeof k === 'string' ? k.toLowerCase() : k;
      let value = Array.isArray(v) ? v[v.length - 1] : v; value = typeof value === 'string' ? value.toLowerCase() : value;
      return [key, value];
    })
  );

  // parse options and attach to req
  req.XMDELAY = getVal(req, argvMap, envMap, 'xmdelay', '0');
  req.XMERROR = getVal(req, argvMap, envMap, 'xmerror', '0');
  req.XMVAL = getVal(req, argvMap, envMap, 'xmval', '0');
  req.XMRESP = getVal(req, argvMap, envMap, 'xmresp', '1');

  // Validation checks
  const errors = [], errorsType = [];

  // Parse and validate XMDELAY - merged branches
  if (req.XMDELAY !== 0) {
    // Extract rate if present, default to 100%
    let delayValue = req.XMDELAY; let rate = 100;
    if (typeof req.XMDELAY === 'string' && req.XMDELAY.includes('@')) {
      const [value, rateStr] = req.XMDELAY.split('@');
      delayValue = value; rate = parseFloat(rateStr);      
      // Validate rate
      if (isNaN(rate) || rate < 0 || rate > 100) {
        errorsType.push('XMDELAY');
        errors.push({
          field: 'XMDELAY',
          value: req.XMDELAY,
          message: `Invalid rate in XMDELAY. Rate must be 0-100 (percentage). Example: XMDELAY=1000@25 means 1000ms delay at 25% probability.`
        });
      }
    }
    // Now validate delayValue (applies to both @rate and non-@rate)
    // Handle range syntax (e.g., "500-3000")
    if (typeof delayValue === 'string' && delayValue.includes('-')) {
      const [minStr, maxStr] = delayValue.split('-');
      const min = parseInt(minStr); const max = parseInt(maxStr);
      if (isNaN(min) || isNaN(max) || min < 0 || max > OPTS.MAXDELAY_MS || min >= max) {
        errorsType.push('XMDELAY');
        errors.push({
          field: 'XMDELAY', value: req.XMDELAY,
          message: `Invalid delay range. Format: min-max@rate (e.g., 500-3000@40). Min must be < max, both 0-${OPTS.MAXDELAY_MS}.`
        });
      } else {
        delayValue = `${min}-${max}`;
      }
    }
    // Handle keywords
    else if (!['random', 'timeout'].includes(delayValue)) {
      const fixed = parseInt(delayValue);
      if (isNaN(fixed) || fixed < 0 || fixed > OPTS.MAXDELAY_MS) {
        errorsType.push('XMDELAY');
        errors.push({
          field: 'XMDELAY', value: req.XMDELAY,
          message: `Invalid delay value. Must be 1-${OPTS.MAXDELAY_MS}, 'random', 'timeout', or range (min-max). Example: XMDELAY=1000@25`
        });
      } else {
        delayValue = fixed;
      }
    }
    // Store parsed value and rate (only if no errors)
    if (!errorsType.includes('XMDELAY')) {
      req.XMDELAY = { value: delayValue, rate };
    }
  } // end XMDELAY parsing

  // Parse and validate XMERROR - merged branches
  if (req.XMERROR !== 0) {
    // Extract rate if present, default to 100%
    let errorValue = req.XMERROR; let rate = 100;
    if (typeof req.XMERROR === 'string' && req.XMERROR.includes('@')) {
      const [value, rateStr] = req.XMERROR.split('@');
      errorValue = value; rate = parseFloat(rateStr);
      // Validate rate
      if (isNaN(rate) || rate < 0 || rate > 100) {
        errorsType.push('XMERROR');
        errors.push({
          field: 'XMERROR', value: req.XMERROR,
          message: `Invalid rate in XMERROR. Rate must be 0-100 (percentage). Example: XMERROR=503@20 means 503 error at 20% probability.`
        });
      }
    }
    // Now validate errorValue (applies to both @rate and non-@rate)
    // Handle CSV list (e.g., "500,503,502")
    if (typeof errorValue === 'string' && errorValue.includes(',')) {
      const codes = errorValue.split(',').map(c => parseInt(c.trim()));
      const invalidCodes = codes.filter(c => isNaN(c) || c < 400 || c > 599);
      if (invalidCodes.length > 0) {
        errorsType.push('XMERROR');
        errors.push({
          field: 'XMERROR', value: req.XMERROR,
          message: `Invalid error codes in CSV list. All codes must be 400-599. Invalid: ${invalidCodes.join(',')}`
        });
      } else {
        errorValue = codes; // Store as array
      }
    }
    // Handle keywords
    else if (!['random', '4xx', '5xx', 'auth', 'corrupt', 'quota', 'gateway'].includes(errorValue)) {
      const code = parseInt(errorValue);
      if (isNaN(code) || code < 400 || code > 599) {
        errorsType.push('XMERROR');
        errors.push({
          field: 'XMERROR', value: req.XMERROR,
          message: `Invalid error code. Must be 400-599, 'random', '4xx', '5xx', 'auth', 'quota', 'gateway', 'corrupt', or CSV list (400-599). Example: XMERROR=503@20`
        });
      } else {
        errorValue = code;
      }
    }
    // Store parsed value and rate (only if no errors)
    if (!errorsType.includes('XMERROR')) {
      req.XMERROR = { value: errorValue, rate };
    }
  } // end XMERROR parsing

  // Validate XMVAL
  if (!Number.isInteger(req.XMVAL) || req.XMVAL < 0 || req.XMVAL > 3) {
    errorsType.push('XMVAL');
    errors.push({
      field: 'XMVAL', value: req.XMVAL,
      message: `Invalid XMVAL value. Valid values = 0,1,2,3 (0=none, 1=request-validation, 2=response-validation, 3=both-validation)`
    });
  }

  // Validate XMRESP
  if (!Number.isInteger(req.XMRESP) || req.XMRESP < 0 || req.XMRESP > 2) {
    errorsType.push('XMRESP');
    errors.push({
      field: 'XMRESP', value: req.XMRESP,
      message: `Invalid XMRESP value. Valid values = 0,1,2 (0=empty-response, 1=random-mock-response, 2=business-logic-response)`
    });
  }

  // Return error if validation failed
  if (errors.length > 0) {
    return res.status(400).json({
      error: {
        code: 400, message: 'Invalid configuration options provided',
        status: 'INVALID_ARGUMENT', 
        errors, // == 'errors': errors
      }
    });
  }
  next();
}

// check console timer/performance
const T = (label) => console.time(label); const TE = (label) => console.timeEnd(label);
// override console.log to add timestamp
const originalLog = console.log; console.log = function (...args) { originalLog(`[${new Date().toLocaleString()}]`, ...args); };

// lru cache for lazy loaded services
/** routerCache @type {LRUCache<string, Router>} */
export let routerCache;
export function initRouterCache(opts) {
  routerCache = new LRUCache({
    max: opts.LRU_MAXITEMS,
    ttl: opts.LRU_TTL_MINS * 60 * 1000,
    updateAgeOnGet: true,
    allowStale: true,
    dispose: (value, key, reason) => {
      // console.log(`Purged router for service "${key}" from LRU cache (reason: ${reason})`);
      unloadServiceSchemas(key);
    }
  });
  // set up periodic purge if not already set
  if (!initRouterCache.purgeInterval) {
    initRouterCache.purgeInterval = setInterval(
      () => { routerCache.purgeStale(); },
      opts.LRU_AUTOPURGE_MINS * 60 * 1000
    );
  }
}

// global AJV instance for schema validation
/** GAJV @type {Ajv}  */
let GAJV;

// Initialize a global AJV instance with custom keywords and formats
function initializeAjv() {
  GAJV = new Ajv({ allErrors: true, verbose: true, strict: true, coerceTypes: true, useDefaults: true, allowUnionTypes: true, removeAdditional: false });
  // Global custom keyword: "xannreq" to handle method-specific required fields (annontations.required in google discovery docs)
  GAJV.addKeyword({
    keyword: "xannreq", type: "object", schemaType: "array", errors: true, modifying: false,
    /**
    * @param {string[]} annList - The array of xannreq entries in schema
    * @param {Object} data - The actual object being validated
    * @param {Object} parentSchema - The schema node containing the keyword
    * @param {Object} ctx - Ajv context, including rootData with runtime metadata
    * @returns {boolean} - true if valid, false if invalid, with errors set 
    */
    validate: function validate(annList, data, parentSchema, ctx) {
      // Access metadata from rootData.meta
      const svc = ctx.rootData?.meta?.svc;
      const mid = ctx.rootData?.meta?.mid;
      if (!svc || !mid || !annList) return true; // nothing to check
      const missingProps = [];
      // Loop through all annotation entries like "svc@methodid@field"
      for (const ann of annList) {
        const [annSvc, annMet, annFld] = ann.split("@");
        if (annSvc === svc && annMet === mid) {
          // check if required field is missing in data
          if (!(annFld in data)) missingProps.push(annFld);
        }
      }
      if (missingProps.length) {
        // Attach detailed Ajv-style errors
        // this.errors NOT WORKING, validate.errors WORKING fine here
        validate.errors =
          missingProps.map(fld => ({
            instancePath: `${ctx.instancePath}/${fld}`,
            schemaPath: `${ctx.instancePath}/${fld}`,
            keyword: "annotations.required",
            params: { missingProperty: fld, service: svc, methodId: mid },
            message: `missing required property '${ctx.instancePath}/${fld}' for ${svc} > ${mid}`
          }));
        return false;
      }
      return true;
    }
  }); // end addKeyword xannreq
  // load all ajv formats (e.g., date-time, email, uri, etc.)
  addFormats(GAJV);
} // initializeAjv

// load the router for a given service, from memory, cache, or build it.
async function loadRouter(service) {
  try {
    //T(`loadRouter:${service}:outer`);
    // check LRU cache
    if (allServices[service] && routerCache.has(service)) {
      // console.log(`Loading router for ${service} from LRU cache`);
      return routerCache.get(service);
    }
    // build the router from specs
    const router = await createRouterFromSpec(service);
    // cache router if valid service
    if (allServices[service]) {
      routerCache.set(service, router);
      // console.log(`Loaded router for ${service} into LRU cache`);
    }
    return router; // return the router
  } catch (err) {
    throw new Error(`ERROR: Failed to loadRouter for ${service}: ${err.message}`);
  }
  finally {
    //TE(`loadRouter:${service}:outer`);
  }
} // loadRouter

// add AJV schemas from spec file for a given service
async function addSchemasFromSpec(service, trace = '') {
  if (GAJV == null) initializeAjv(); // initialize global AJV if not already done
  // const validatorPath = new URL(`./data/${service}_v.json`, import.meta.url);
  if (!GAJV.getSchema(service)) { // only add if service schema not already present
    // const spec11 = JSON.parse(await fs.readFile(validatorPath, 'utf8'));
    const spec11 = JSON.parse(await loadFile(`data/${service}_v.json`, service));
    try { if (spec11.$defs != null) GAJV.addSchema(spec11); } catch { }
    // console.log(`Loaded AJV schemas for "${service}" [${trace}]`);
    return true; // schemas added
  }
  return false; // schemas already present
} // addSchemasFromSpec

// create a router for a given service & add ajv schemas & handlers
async function createRouterFromSpec(service) {
  let schemasAdded = false;
  // const specPath = new URL(`./data/${service}_s.json`, import.meta.url);
  try {
    // Add validation schemas and track if added
    schemasAdded = await addSchemasFromSpec(service, ':createRouterFromSpec');
    // Create the router
    const router = Router({ ignoreTrailingSlash: false, caseSensitive: true, maxParamLength: 2000 });
    // Load the pre-processed spec for routes
    // const spec = JSON.parse(await fs.readFile(specPath, 'utf8'));
    const spec = JSON.parse(await loadFile(`data/${service}_s.json`, service));
    // Register all routes with the service
    for (const r of spec.r) {
      try {
        const storeData = { mid: r.mid };
        if (r.mfp) storeData.mfp = r.mfp; if (r.mop) storeData.mop = r.mop;
        if (r.rx) storeData.rx = r.rx; if (r.md) storeData.md = r.md;
        router.on(r.m, r.p, businessLogic, storeData);
      } catch (err) {
        console.log(`ERROR: Failed to register route [${r.m}] ${r.p} for ${service} ${r.mid} : ${err.message}`, r);
      }
    }
    // console.log(service, spec, router.prettyPrint());
    // console.log(`Created router for "${service}" with ${spec.r.length} methods`);
    return router;
  } catch (err) {
    if (schemasAdded) {
      unloadServiceSchemas(service);
    }
    throw new Error(`Failed to createRouterFromSpec for ${service}: ${err.code} ${err.message}`);
  } finally {
    // TE(`createRouterFromSpec:${service}`);
  }
} // createRouterFromSpec

// simulate network latency
export async function mockDelays(req, res, next) {
  const service = req.XMSERVICE; // set by googleParser middleware
  if (!service || !allServices[service]) return next(); // only delay for valid services

  // Check if XMDELAY is set and not zero
  if (!req.XMDELAY || req.XMDELAY === 0) return next();

  const delayConfig = req.XMDELAY; const value = delayConfig.value; const rate = delayConfig.rate;

  // Apply probability check
  if (rate < 100 && Math.random() * 100 >= rate) {
    // Skip delay - probability check failed
    res.setHeader('XMDELAY', `${value.toUpperCase()} @ ${rate}% (SKIPPED)`);
    return next();
  }

  // Determine actual delay value
  let actualDelay = 0;

  if (value === 'timeout') {
    const timeoutMs = OPTS.MAXDELAY_MS;
    res.setHeader('XMDELAY', `TIMEOUT ${timeoutMs} ms @ ${rate}% (APPLIED)`);
    const timeoutTimer = setTimeout(() => {
      cleanup();
      if (req.socket && !req.socket.destroyed) {
        req.socket.destroy();
      }
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timeoutTimer);
      req.removeListener('close', cleanup);
      req.removeListener('aborted', cleanup);
      req.removeListener('error', cleanup);
    }
    req.once('close', cleanup);
    req.once('aborted', cleanup);
    req.once('error', cleanup);
    return; // Don't call next() - let timeout destroy connection
  }
  else if (typeof value === 'string' && value.includes('-')) {
    // Range delay (e.g., "500-3000")
    const [min, max] = value.split('-').map(v => parseInt(v));
    actualDelay = Math.floor(Math.random() * (max - min + 1)) + min;
    actualDelay = Math.min(actualDelay, OPTS.MAXDELAY_MS);
    res.setHeader('XMDELAY', `${value} ms @ ${rate}% (APPLIED ${actualDelay} ms)`);
  }
  else if (value === 'random') {
    let min = 200, max = OPTS.MAXDELAY_MS;
    actualDelay = Math.floor(Math.random() * (max - min + 1)) + min;
    actualDelay = Math.min(actualDelay, OPTS.MAXDELAY_MS);
    res.setHeader('XMDELAY', `RANDOM @ ${rate}% (APPLIED ${actualDelay} ms)`);
  }
  else if (Number.isInteger(value)) {
    // Fixed delay
    actualDelay = Math.min(value, OPTS.MAXDELAY_MS);
    res.setHeader('XMDELAY', `${actualDelay} ms @ ${rate}% (APPLIED)`);
  }

  if (actualDelay > 0) {
    // console.log(`Delaying request for ${actualDelay} ms => ${req.method} ${req.url} ...`);
    const completed = await new Promise((resolve) => {
      const timer = setTimeout(() => { cleanup(); resolve(true); }, actualDelay);
      function onClose() { cleanup(); resolve(false); }
      function cleanup() { clearTimeout(timer); req.off?.('close', onClose); req.removeListener?.('close', onClose); }
      req.on('close', onClose);
    });
    if (!completed) {
      // Client disconnected during delay
      // console.log(`WARNING: Client aborted during ${actualDelay} ms delay: ${req.method} ${req.url}`);
      if (!res.headersSent) { return res.status(499).end(); }
      return;
    }
    // console.log(`Delay completed (${actualDelay} ms) => ${req.method} ${req.url}`);
  }
  next();
} // mockDelays

// mock error generation
export function mockErrors(req, res) {
  const service = req.XMSERVICE; // set by googleParser middleware
  if (!service || !allServices[service]) return false; // only for valid services

  // Check if XMERROR is set and not zero
  if (!req.XMERROR || req.XMERROR === 0) return false;

  const errorConfig = req.XMERROR; const value = errorConfig.value; const rate = errorConfig.rate;

  // Apply probability check
  if (rate < 100 && Math.random() * 100 >= rate) {
    // Skip error - probability check failed
    res.setHeader('XMERROR', `${Array.isArray(value) ? value.join(',') : (value+'').toUpperCase()} @ ${rate}% (SKIPPED)`);
    return false;
  }

  // Determine actual error code
  let errorCode; let errorType = '';

  if (Array.isArray(value)) {
    // CSV list - pick random code
    errorCode = value[Math.floor(Math.random() * value.length)];
    errorType = `${value.join(',')}`;
    res.setHeader('XMERROR', `${errorType} @ ${rate}% (APPLIED ${errorCode})`);
  }
  else if (value === 'corrupt') {
    res.setHeader('XMERROR', `CORRUPT @ ${rate}% (APPLIED)`);
    const corruptTypes = [
      () => res.status(200).set('Content-Type', 'application/json').send('{"corrupt data response. {{invalid json syntax'),
      () => res.status(200).send('<html>corrupted data response - unexpected html</>'),
      () => res.status(200).send(Math.random().toString(36).repeat(100)),
    ];
    req.resume(); // Drain stream before responding
    corruptTypes[Math.floor(Math.random() * corruptTypes.length)]();
    return true;
  }
  else if (value === 'random') {
    const errorCodes = [400, 401, 403, 404, 408, 409, 429, 500, 502, 503, 504];
    errorCode = errorCodes[Math.floor(Math.random() * errorCodes.length)];
    res.setHeader('XMERROR', `RANDOM @ ${rate}% (APPLIED ${errorCode})`);
  }
  else if (value === '4xx') {
    const errorCodes = [400, 401, 403, 404, 405, 406, 408, 409, 410, 412, 413, 415, 416, 422, 428, 429, 431, 451];
    errorCode = errorCodes[Math.floor(Math.random() * errorCodes.length)];
    res.setHeader('XMERROR', `4XX @ ${rate}% (APPLIED ${errorCode})`);
  }
  else if (value === '5xx') {
    const errorCodes = [500, 501, 502, 503, 504, 505, 507, 508, 509, 510, 511];
    errorCode = errorCodes[Math.floor(Math.random() * errorCodes.length)];
    res.setHeader('XMERROR', `5XX @ ${rate}% (APPLIED ${errorCode})`);
  }
  else if (value === 'auth') {
    const errorCodes = [401, 403];
    errorCode = errorCodes[Math.floor(Math.random() * errorCodes.length)];
    res.setHeader('XMERROR', `AUTH @ ${rate}% (APPLIED ${errorCode})`);
  }
  else if (value === 'quota') {
    const errorCodes = [429, 509];
    errorCode = errorCodes[Math.floor(Math.random() * errorCodes.length)];
    res.setHeader('XMERROR', `QUOTA @ ${rate}% (APPLIED ${errorCode})`);
  }
  else if (value === 'gateway') {
    const errorCodes = [502, 503, 504];
    errorCode = errorCodes[Math.floor(Math.random() * errorCodes.length)];
    res.setHeader('XMERROR', `GATEWAY @ ${rate}% (APPLIED ${errorCode})`);
  }
  else if (Number.isInteger(value)) {
    // Fixed error code
    errorCode = value;
    res.setHeader('XMERROR', `${errorCode} @ ${rate}% (APPLIED)`);
  }
  // Send error response
  if (errorCode) {
    res.status(errorCode).json({
      error: {
        code: errorCode,
        message: `Mock Error Response [${errorCode}], generated based on config/options`,
        status: 'MOCK_ERROR',
        errors: [`Config option XMERROR = ${res.getHeader('XMERROR')}`]
      }
    });
    return true;
  }
  return false;
} // mockErrors

// dynamic route handler middleware
export async function routeHandler(req, res, next) {
  const service = req.XMSERVICE; // set by googleParser middleware
  if (!service || !allServices[service]) return next(); // skip if no valid service
  // T('routeHandler');
  try {
    // Handle X-HTTP-Method-Override header (https://developers.google.com/workspace/tasks/performance#patch-alt-notation)
    let method = req.method;
    if (method === 'POST' && req.headers['x-http-method-override']) {
      const override = req.headers['x-http-method-override'].toUpperCase();
      if (['PATCH', 'PUT', 'DELETE'].includes(override)) {
        method = override;
        req.XMORGMETHOD = 'POST'; // Track original for logging/debugging
      }
    }
    req.XMMETHOD = method;
    // Load the router for the service
    const router = await loadRouter(service);
    // Reconstruct the request path for routing
    const reqPath = req.path || '/';
    let match, transformedPath = reqPath;

    // matches patterns like :move_tag_id at end of path (custom actions)
    const customActionRegex = /:[^:]+$/;
    // test if the path ends with a custom action pattern (e.g., :testIamPermissions)
    if (customActionRegex.test(reqPath)) {
      const lastColonIndex = reqPath.lastIndexOf(':');
      transformedPath = reqPath.substring(0, lastColonIndex) + '/' + reqPath.substring(lastColonIndex + 1);
      match = router.find(method, transformedPath);
    }
    // If no match was found with the transformation, try the original path
    if (!match) {
      transformedPath = reqPath; // reset to original
      match = router.find(method, reqPath);
    }
    // If still no match, return 404
    if (!match || !match.handler) {
      return res.status(404).json({
        error: {
          code: 404,
          message: `Invalid route/url for service = '${service}', alias = '${allServices[service]?.id}', method = '${req.method}${method != req.method ? '/' + method : ''}', path = '${req.path}'. Please check the service API documentation for valid endpoints.`,
          status: 'NOT_FOUND'
        }
      });
    }
    // Extract validators and schemas from route store
    const { store } = match;
    req.XMSTORE = store || {}; // attach store meta to request
    const mediaFlag = store.md || ''; // '1'=upload, '2'=download, '12'=both

    const requestSchemaRef = `${service}.${store.mid}.req`;
    const responseSchemaRef = `${service}.${store.mid}.res`;
    let requestValidator, responseValidator;

    // convert params to validation specs {+var} {var} style parameters (method.path vs method.flatPath)
    let valParams = match.params;
    req.XMPARAMS = match.params; // attach original params to request
    if (store.mop && store.mfp && store.mop !== store.mfp && store.rx) {
      const re = new RegExp(store.rx); // Compile regex just-in-time
      const regexMatch = transformedPath.match(re);
      valParams = regexMatch?.groups || null;
    }
    req.XMVALPARAMS = valParams; // attach validation params to request

    req.XMINFO = `${service} / ${allServices[service]?.id} / ${method} / ${store.mid}`;
    res.setHeader('XMINFO', req.XMINFO);

    // Handle mock errors if configured
    if (mockErrors(req, res)) return;

    requestValidator = GAJV.getSchema(requestSchemaRef);
    if (!requestValidator) { await addSchemasFromSpec(service, ':requestValidation'); requestValidator = GAJV.getSchema(requestSchemaRef) || null; }

    // Determine body for validation (skip Buffer raw uploads)
    const isRawUpload = Buffer.isBuffer(req.body);
    const bodyForValidation = isRawUpload ? {} : (req.body || {});

    // Request Validation middleware = 1 or 3 (request only or both request/response)
    if ([1, 3].includes(req.XMVAL) && !isRawUpload) {
      res.setHeader('XMVAL', `${req.XMVAL}`);
      if (!requestValidator) {
        return res.status(500).json({
          error: {
            code: 500,
            message: `Request Validator not found for [${service}] [${store.mid}] [${requestSchemaRef}].`,
            status: 'INTERNAL'
          }
        });
      }
      // meta is used to pass runtime info for ajv custom keywords like xannreq (annotations.required handling)
      const dataToValidate = {
        body: bodyForValidation, params: valParams || {}, query: req.query || {},
        gparams: valParams || {}, gquery: req.query || {}, meta: { svc: service, mid: store.mid }
      };
      // await fs.writeFile('./trace2.json', JSON.stringify(dataToValidate, null, 2));
      const isValid = requestValidator(dataToValidate);
      if (!isValid) {
        return res.status(400).json({
          error: {
            code: 400,
            message: `Request validation failed for [${service}] [${store.mid}] >>> ${GAJV.errorsText(requestValidator.errors)}`,
            status: 'INVALID_ARGUMENT',
            errors: requestValidator.errors
          }
        });
      }
    } // end request validation

    responseValidator = GAJV.getSchema(responseSchemaRef);
    if (!responseValidator) { await addSchemasFromSpec(service, ':responseValidation'); responseValidator = GAJV.getSchema(responseSchemaRef) || null; }

    // Mock Response Generation, save response for sending later, after validation
    let mockResponse = {}; // default empty response
    if (req.XMRESP === 1) {
      res.setHeader('XMRESP', `${req.XMRESP}`);

      // handle media download requests
      if (mediaFlag?.includes('2') && req.query?.alt == 'media') {
        const mockBinary = Buffer.from('MOCK_BINARY_DATA_PLACEHOLDER', 'utf-8');
        return res.status(200)
          .set({
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': 'attachment; filename="mock-download.bin"'
          })
          .send(mockBinary);
      } // end media download handling

      if (responseValidator) {
        mockResponse = generateMockFromSchema(responseValidator?.schema || GAJV.schemas?.[responseSchemaRef]?.schema,
          GAJV.schemas?.[service]?.schema?.$defs, '', `[${responseSchemaRef}]`, 0);
      }
    }
    // response with business logic from handler
    else if (req.XMRESP === 2) {
      res.setHeader('XMRESP', `${req.XMRESP}`);
      // Call the matched handler for business logic
      mockResponse = await match.handler(req, res);
      mockResponse = mockResponse ?? {};
    }

    // validate response = XVALIDATE = 2 or 3 (response only or both request/response)
    if ([2, 3].includes(req.XMVAL)) {
      res.setHeader('XMVAL', `${req.XMVAL}`);
      if (responseValidator) {
        const isValid = responseValidator(mockResponse);
        if (!isValid) {
          return res.status(400).json({
            error: {
              code: 400,
              message: `Response validation failed for [${service}] [${store.mid}] >>> ${GAJV.errorsText(responseValidator.errors)}`,
              status: 'INVALID_ARGUMENT',
              errors: [...responseValidator.errors, mockResponse]
            }
          });
        }
      }
    } // end response validation

    // Return mock response if requested
    if ([1, 2].includes(req.XMRESP)) {
      let successStatus = 200; const mid = store.mid.toLowerCase();
      if (method === 'POST' && (mid.endsWith('create') || mid.endsWith('insert'))) { successStatus = 201; }
      else if (method === 'DELETE') { successStatus = 204; }
      if (successStatus === 204 || !mockResponse) return res.status(successStatus).send();
      return res.status(successStatus).json(mockResponse);
    } // end return mock response

    // return empty response as default
    return res.status(200).send();

  } catch (err) {
    // console.log(`Router load error for ${service}: ${err.message}`, err);
    // one-liner to capture all own properties as an array of {prop: value}
    // Object.getOwnPropertyNames(err).map(k => ({ [k]: err[k] })),

    // if service is premium, provide detailed error info
    if (err.message?.match(/@@Service.*@@/)) {
      let match = err.message?.match(/@@(Service.*)@@/);
      return res.status(403).json({
        error: {
          code: 403,
          message: `Access denied. ${match[1]}`,
          status: 'PREMIUM_SERVICE_REQUIRED',
        }
      });
    }
    return res.status(500).json({
      error: {
        code: 500,
        message: `Service processing failed due to runtime errors.`,
        status: 'INTERNAL',
        errors: [{ error: err.message, stack: err.stack }],
      }
    });
  }
  finally {
    // TE('routeHandler');
  }
} // routeHandler


// Example business logic handler (can be expanded as needed)
function businessLogic(req, res, params, store) {
  try {
    // handler/business logic for simulations/stateful/operations
    // service/method-id specific logic can be implemented here
    // For demonstration, just return all available info here
    switch (req.XMSERVICE + '@' + req.XMSTORE.mid) {
      // case 'storagev1@storage.objects.get':
      // Simulate a storage object retrieval
      // case 'storagev1@storage.objects.insert':
      // Simulate a storage object insertion
      default:
        return {
          service: req.XMSERVICE, method: `${req.XMMETHOD} / ${req.method}`, methodId: req.XMSTORE.mid,
          requestId: req.XMREQID, region: req.XMREGION, info: req.XMINFO,
          validationParams: req.XMVALPARAMS, expandedParams: req.XMPARAMS, queryParams: req.query,
          headers: req.headers, metainfo: req.XMSTORE,
          handlerParams: params, handlerStore: store,
          message: 'This is a default business logic response. To implement custom behavior, please contact us for premium access/support/customizations.',
          reqBody: "req.body contains parsed body for JSON/text/xml/form-data/Buffer for binary & media uploads/empty for no-body methods.",
          multipart: "For multipart/related or multipart/mixed, req.body = parsed JSON metadata (first part), and req.files[] = array of file parts with metadata.",
          reqRawBody: "req.rawBody contains raw Buffer before parsing (truncated to OPTS.BODY_TRUNCATED size), null for multipart requests.",
          reqFiles: "req.files contains uploaded files & their metainfo for multipart & form-data requests, empty otherwise.",
          customLogic: "To implement custom business logic for this service/method, please modify the businessLogic() function in routerManager.js OR please contact us for premium access/support/customizations."
        };
    }
  } catch (err) {
    throw new Error(`BusinessLogic error in ${req.XMSERVICE}/${req.XMSTORE.mid}: ${err.message}`);
  }
}

// Unload AJV schemas for a given service
function unloadServiceSchemas(service) {
  if (!GAJV || !service || !allServices[service]) return;
  try {
    const esc = service.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${esc}(\\.|$)`);
    GAJV.removeSchema(pattern); // removes service, service.method.req/res, etc.
    // console.log(`Unloaded AJV schemas: ${service}`);
  } catch (err) {
    // console.log(`ERROR: Failed to unload AJV schemas for ${service}: ${err.message}`, err);
  } finally {
  }
} // unloadServiceSchemas

// get cache statistics for monitoring
export function getCacheStats() {
  return {
    lruCacheMax: routerCache.max,
    lruCacheSize: routerCache.size,
    lruCacheServices: Array.from(routerCache.keys()),
    ajvSchemaServices: GAJV ? [...Object.keys(GAJV.schemas)] : [],
  };
} // getCacheStats

// Preload routers
export async function preloadRouters(services = []) {
  // console.log(`Preloading routers for ${services.length} services...`);
  //await Promise.all(services.map(s => loadRouter(s)));
  let t1 = [], t2 = []; // t1=loaded, t2=not found
  for (const service of services) {
    if (allServices[service]) { t1.push(service); await loadRouter(service); }
    else { t2.push(service); }
  }
  // if (t2.length > 0) console.log(`WARNING: Services "${t2.join(',')}" not found, skipping preload...`);
  if (t1.length > 0) console.log(`Preloaded routers for services: ${t1.join(',')}`);
} // preloadRouters

// Mapping of HTTP status codes to Google-style status and messages
/*
+--------------------------------------+------+-------------------------------+-----------------------------------------------------------------------------------------------+
| Name Key                             | Code | Status                        | Message / Use Case                                                                              |
+--------------------------------------+------+-------------------------------+-----------------------------------------------------------------------------------------------+
| CONTINUE                             | 100  | CONTINUE                      | Interim response — request received, continue sending body.                                     |
| SWITCHING_PROTOCOLS                  | 101  | SWITCHING_PROTOCOLS           | Used for protocol upgrades (e.g., WebSocket).                                                   |
| PROCESSING                           | 102  | PROCESSING                    | Request accepted and being processed (long-running ops simulation).                             |
| EARLY_HINTS                          | 103  | EARLY_HINTS                   | Preliminary info about the resource (e.g., preloading hints).                                   |
+--------------------------------------+------+-------------------------------+-----------------------------------------------------------------------------------------------+
| OK                                   | 200  | OK                            | Standard success response for GET, PUT, POST returning resource.                                |
| CREATED                              | 201  | CREATED                       | Resource created. Include `Location` header with new resource URI.                              |
| ACCEPTED                             | 202  | ACCEPTED                      | Request accepted for processing, operation pending (return operation resource link).            |
| NON_AUTHORITATIVE_INFORMATION        | 203  | NON_AUTHORITATIVE_INFORMATION | Metadata from non-authoritative source (cache, mirror).                                         |
| NO_CONTENT                           | 204  | NO_CONTENT                    | Successful request but no response body (DELETE, PATCH updates).                                |
| RESET_CONTENT                        | 205  | RESET_CONTENT                 | Client should reset form or UI (rare).                                                           |
| PARTIAL_CONTENT                      | 206  | PARTIAL_CONTENT               | Range/stream responses — useful for mediaDownload or resumable uploads.                          |
| MULTI_STATUS                         | 207  | MULTI_STATUS                  | Batch operations returning mixed results per sub-request.                                       |
| ALREADY_REPORTED                     | 208  | ALREADY_REPORTED              | Avoid duplicate resource reporting (rare).                                                       |
| IM_USED                              | 226  | IM_USED                       | Resource returned with applied delta/patch (rare).                                               |
+--------------------------------------+------+-------------------------------+-----------------------------------------------------------------------------------------------+
| MULTIPLE_CHOICES                     | 300  | MULTIPLE_CHOICES              | Multiple possible resources; version/content negotiation or alternate endpoints.                |
| MOVED_PERMANENTLY                    | 301  | MOVED_PERMANENTLY             | Resource URI permanently changed — clients should update stored URIs.                           |
| FOUND                                | 302  | FOUND                         | Temporary redirect — used for signed URL redirects or short-lived relocation.                   |
| SEE_OTHER                            | 303  | SEE_OTHER                     | Redirect to a different URI using GET (useful after POST/async completion).                     |
| NOT_MODIFIED                         | 304  | NOT_MODIFIED                  | Caching response — client cache still valid (ETag / If-None-Match).                             |
| USE_PROXY                            | 305  | USE_PROXY                     | Deprecated; historically signaled a proxy is required.                                          |
| RESERVED                             | 306  | (RESERVED)                    | Previously "Switch Proxy"; reserved and not used.                                               |
| TEMPORARY_REDIRECT                   | 307  | TEMPORARY_REDIRECT            | Temporary redirect that preserves method and body (resumable upload/download flows).            |
| PERMANENT_REDIRECT                   | 308  | PERMANENT_REDIRECT            | Permanent redirect that preserves method and body — useful for non-destructive migrations.      |
+--------------------------------------+------+-------------------------------+-----------------------------------------------------------------------------------------------+
| INVALID_ARGUMENT                     | 400  | INVALID_ARGUMENT              | Invalid value for a field (e.g., resource.name).                                                |
| FAILED_PRECONDITION                  | 400  | FAILED_PRECONDITION           | Precondition check failed.                                                                      |
| OUT_OF_RANGE                         | 400  | OUT_OF_RANGE                  | Page size must not exceed allowed max.                                                           |
| MISSING_REQUIRED_FIELD               | 400  | INVALID_ARGUMENT              | Missing required field (e.g., projectId).                                                       |
| UNAUTHENTICATED                      | 401  | UNAUTHENTICATED               | Invalid authentication credentials.                                                              |
| PERMISSION_DENIED                    | 403  | PERMISSION_DENIED             | Caller does not have permission.                                                                 |
| INVALID_API_KEY                      | 403  | PERMISSION_DENIED             | API key not valid.                                                                               |
| ACCESS_NOT_CONFIGURED                | 403  | PERMISSION_DENIED             | API not enabled or not used in project before.                                                   |
| SECURITY_POLICY_VIOLATION            | 403  | PERMISSION_DENIED             | Request violates security policy.                                                                |
| NOT_FOUND                            | 404  | NOT_FOUND                     | Requested resource not found.                                                                    |
| METHOD_NOT_ALLOWED                   | 405  | METHOD_NOT_ALLOWED            | HTTP method not allowed for this endpoint.                                                       |
| NOT_ACCEPTABLE                       | 406  | NOT_ACCEPTABLE                | Requested representation not acceptable.                                                         |
| REQUEST_TIMEOUT                      | 408  | REQUEST_TIMEOUT               | The request timed out. Please retry.                                                             |
| CONFLICT                             | 409  | CONFLICT                      | Resource already exists or version conflict.                                                     |
| GONE                                 | 410  | NOT_FOUND                     | Resource is no longer available.                                                                 |
| LENGTH_REQUIRED                      | 411  | INVALID_ARGUMENT              | Content-Length header required but missing.                                                      |
| PRECONDITION_FAILED                  | 412  | FAILED_PRECONDITION           | Preconditions on the request evaluated to false.                                                |
| REQUEST_ENTITY_TOO_LARGE             | 413  | PAYLOAD_TOO_LARGE             | Request payload exceeds allowed size.                                                            |
| UNSUPPORTED_MEDIA_TYPE               | 415  | UNSUPPORTED_MEDIA_TYPE        | Unsupported Content-Type for the request.                                                        |
| RANGE_NOT_SATISFIABLE                | 416  | OUT_OF_RANGE                  | Requested range not satisfiable for the resource.                                               |
| PRECONDITION_REQUIRED                | 428  | FAILED_PRECONDITION           | Server requires the request to be conditional.                                                   |
| TOO_MANY_REQUESTS                     | 429  | RESOURCE_EXHAUSTED           | Rate limit exceeded. Please retry later.                                                         |
| QUOTA_EXCEEDED                        | 429  | RESOURCE_EXHAUSTED           | Quota exceeded for the API.                                                                      |
| REQUEST_HEADER_FIELDS_TOO_LARGE      | 431  | INVALID_ARGUMENT              | One or more request header fields too large.                                                     |
| UNAVAILABLE_FOR_LEGAL_REASONS        | 451  | PERMISSION_DENIED             | Access restricted for legal reasons.                                                             |
+--------------------------------------+------+-------------------------------+-----------------------------------------------------------------------------------------------+
| INTERNAL                             | 500  | INTERNAL                      | Internal error encountered.                                                                      |
| BACKEND_ERROR                        | 500  | INTERNAL                      | Backend service temporarily unavailable.                                                         |
| DATA_LOSS                            | 500  | DATA_LOSS                     | Unrecoverable data loss or corruption.                                                           |
| UNKNOWN                              | 500  | UNKNOWN                       | An unknown internal error occurred.                                                              |
| UNIMPLEMENTED                        | 501  | UNIMPLEMENTED                 | Operation not implemented or not supported by the service.                                      |
| BAD_GATEWAY                          | 502  | INTERNAL                      | Upstream returned an invalid response (transient).                                               |
| UNAVAILABLE                          | 503  | UNAVAILABLE                   | Service currently unavailable. Please retry later.                                               |
| DEADLINE_EXCEEDED                    | 504  | DEADLINE_EXCEEDED             | Deadline exceeded while waiting for backend response.                                           |
| GATEWAY_TIMEOUT                      | 504  | DEADLINE_EXCEEDED             | Gateway/upstream timed out (map to deadline exceeded).                                          |
| HTTP_VERSION_NOT_SUPPORTED           | 505  | INTERNAL                      | Server does not support the HTTP protocol version used.                                          |
| INSUFFICIENT_STORAGE                 | 507  | INTERNAL                      | Service cannot store the representation needed to complete the request.                          |
+--------------------------------------+------+-------------------------------+-----------------------------------------------------------------------------------------------+
*/
