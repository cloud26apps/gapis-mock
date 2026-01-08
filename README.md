# gapis-mock - Mock server for Google APIs
Mock server for Google APIs, for local dev/testing only. Based on Google discovery documents. Not Affiliated with Google.

## Changelog
v1.0.0 20260108 - First public release

## Features

**Google API Mocking** - Mocks all Google REST APIs services based on Discovery documents, covers 500+ APIs services, all versions (stable/alpha/etc), 22000+ endpoints/methods. Open Source, Apache-licensed, customizable.

**Works Offline** - No internet connection needed, works completely offline for local dev/testing. No quotas, no billing costs, no limits, no risk of affecting live production data. Bundled "data.zip" file contains all discovery documents, json schemas, router specs, api directory, etc. 

**Dynamic API Routing** - Dynamically routes requests to the correct APIs/service/method based on Discovery info (method/path/headers).

**API Contract Testing** - Validates requests & responses against JSON schemas based on Google API Discovery documents.

**Mock Responses** - Generates dynamic schema-valid stateless mock responses, based on Google discovery schemas.

**Custom Business Logic** - Custom business logic can be added for any service/method easily in one JS function, all fields parsed & available.

**Chaos Testing** - Simulating delays, errors, timeouts, probability-based chaos for testing resiliency, robustness, error-handling, retries, backoffs, etc.

**Local MITM Proxy** - Handles TLS termination, dynamic certs, forwarding *.googleapis.com requests + dns overrides (http/https/connect) to mock simulator, passthrough others, req.headers.xmservice for rooturl/mtls/endpoints overrides. This allows easy & transparent integration with existing clients/libraries/tools/SDKs/CLI.

## Work in progress
- Testing integration of mock server with more clients/libraries/SDKs/tools [- Community help needed](#support)
- Generating Stateful business-logic responses, with persistence in memory/file/db, work in progress [ - Contact us](#support)
- Proxy to Live Google APIs for record replay snapshot hybrid modes, planned for future [ - Contact us](#support)

## Discovery APIs data
Discovery APIs like discovery.apis.getRest & discovery.apis.list methods return real data from the bundled data.zip file (snapshot of Discovery documents live data as on release date). This is needed for dynamic routing & schema validation in the mock server.

## Supported Google APIs Services
All Google REST API services, all versions, are supported, check the [List of Services/Names to use in Mock Server](./LISTSERVICES.md) for details.

## Limitations
- Only Google REST APIs based on Discovery documents are supported
- Authentication/Authorization/IAM/Scopes are ignored, all requests allowed, can be added later
- Batch/batchPath/ResumableUploads not supported, can be added later
- Streaming APIs/gRPC/rest-transcoding/XML APIs are not supported, can be added later
- System params like xml/csv/proto/streams/fields/fieldmasks are ignored, can be added later

## Requirements
- Node.js >= 20.0.0, npm or yarn

## Quick Start & Installation

### Mock Server & Local MITM Proxy

Choose one install/run option below.

1) Install & run (global)
```bash
npm install -g gapis-mock --omit=dev
# runs the mock server
gapis-mock
npx gapis-mock
# runs the local MITM proxy
gapis-proxy
npx gapis-proxy
```

2) Install to a project & run (local)
```bash
npm install gapis-mock --save
# runs the mock server
npx gapis-mock
# runs the local MITM proxy
npx gapis-proxy
```

3) Run from cloned repository (source / development)
```bash
git clone https://github.com/cloud26apps/gapis-mock.git
cd gapis-mock
npm install --omit=dev
# runs the mock server
node simulator.js
# runs the local MITM proxy
node proxy.js
```

### Changing Host & Port for Mock Server & Proxy server

Mock server runs on http://localhost:3333 (default host=localhost, port=3333) . To change mock server host (--xmhost) or port (--xmport), try below
```bash
# use whichever method you used to install, any of the below
gapis-mock --xmhost=127.0.0.1 --xmport=4000
npx gapis-mock --xmhost=127.0.0.1 --xmport=4000
node simulator.js --xmhost=127.0.0.1 --xmport=4000
```

Proxy server runs on http://localhost:3344 (default host=localhost, port=3344). To change proxy port (--xmport) / simulator host port (--xmsimhost --xmsimport), try below
```bash
# use whichever method you used to install, any of the below
gapis-proxy --xmport=443 --xmsimhost=127.0.0.1 --xmsimport=4000
npx gapis-proxy --xmport=443 --xmsimhost=127.0.0.1 --xmsimport=4000
node proxy.js --xmport=443 --xmsimhost=127.0.0.1 --xmsimport=4000
```

### Check status of Mock Server and Proxy
Open your web browser or use curl to access the following URLs:

http://localhost:3333 (mock server)  
http://localhost:3333/health (healthcheck)  
http://localhost:3344 (local MITM proxy server)  

### Response headers from Mock Server
The mock server adds the following response headers to indicate applied settings for each request, based on server-level or per-request config sent by the client. XMVAL, XMRESP, XMDELAY, XMERROR are optional response headers and only included when applicable.
```text
header: XMSERVER: GAPIS-MOCK/1.0.0/20260108 (server identifier)
header: XMREQID: 1767254525105-f9r90g3aj (unique request ID)
header: XMINFO: storagev1 / storage:v1 / GET / storage.buckets.list (service/method info)
header: XMVAL: 1 (mock validation type, 0=none,1=request,2=response,3=both)
header: XMRESP: 1 (mock response type, 0=empty,1=schema-valid,2=custom)
header: XMDELAY: 500 ms @ 100% (APPLIED) (mock delay, applied/skipped)
header: XMERROR: 503 @ 10% (SKIPPED) (mock error, applied/skipped)
header: XM***: any other custom headers set by application
```

### Installing CA certificates
For HTTPS interception via local MITM proxy or DNS override on port 443, you need to install/trust the local CA certificate generated by the proxy. On first run of the proxy, it generates a local CA certificate in `./proxy-root-ca.crt` file.  Certificate file location is shown in the proxy log.

### Using other proxy tools
You can use any popular local MITM proxy tools like `mitmproxy`, `Fiddler`, `Burp Suite`, `Charles Proxy`, `Proxifier`, etc. Just configure your proxy to intercept requests to `*.googleapis.com` and forward them to the local mock simulator (http) with original 'host' header or 'x-original-host' or 'x-forwarded-host'. Host headers are used for routing to appropriate service/method in the mock simulator.

## Integration with clients/libraries/SDKs/CLIs/tools
Supports any Google API clients that use standard Google API REST endpoints (e.g. *.googleapis.com)

### Proxy mode
Run the local MITM proxy (included), it will intercept requests to `*.googleapis.com` and forward them to mock server. Set the HTTP_PROXY HTTPS_PROXY environment variables to point to the local proxy server (e.g. http://localhost:3344). Install the local CA certificate for HTTPS interception and/or configure your system to trust the local proxy and/or disable certificate validation for local dev/testing. Certificate file location is shown in the proxy console log.

### DNS override
Override DNS entries for service like `127.0.0.1 storage.googleapis.com` (one entry for each service) to point to the mock server IP address (e.g. 127.0.0.1). Run the local MITM proxy (included) on port 443 for TLS termination. Install the local CA certificate for HTTPS interception and/or configure your system to trust the local proxy and/or disable certificate validation for local dev/testing. No code changes needed in client. Certificate file location is shown in the proxy console log.

### RootURL override
Point your client to the mock server (e.g. http://localhost:3333) by overriding the rootURL/baseURL parameter in your client via config/init/environment/code-change for each service/globally. Exact procedure varies by client/lang/service. Requires code changes in client. For each request, set 'xmservice' header = target service (e.g. 'storagev1', 'computev1', etc), this is needed for dynamic routing. [LIst of Services](LISTSERVICES.md) to use in 'xmservice' header.

Some google clients/libraries/SDKs/CLIs may have hardcoded hostnames, IPs, urls, or certificate pinning that may prevent proxy/DNS override from working, in such cases rootURL override may be the only option.

Refer to the [Usage Examples](#usage-examples) section for more details about current integration status with various clients.

### Community Help
Need community help for testing integration with more clients/libraries/SDKs/CLIs/tools and reporting issues / fixes / workarounds for each client. Please [Contact Us](#support) with your findings.

## Configuration options for Mock Simulations

Configuration can be done in two ways:
- `Server side` via environment variables, command-line args, at server startup, for server-wide settings, applicable to all requests.
- `Client side` via request headers, query parameters, for per-request overrides, applicable to individual requests.
- `Client side` config will override `Server side` config.

Priority order (from highest to lowest):  

`Request Query Parameters (highest) > Request Headers > Command-line Args > Environment Variables > Default Values (lowest)`  

Higher priority settings override lower priority ones.

### General Format for specifying options
- Environment Variables: `export or set OPTION=value` (server-level)
- Command-line Arg: `--option=value` (server-level)
- Request Header: `OPTION: value` (per-request)
- Request Query Parameter: `?option=value` (per-request)

### XMVAL for Request/Response Validation
**Description:** Enables/disables request and/or response validation against JSON schemas.  
**Allowed values**: 0,1,2,3 where 0 = disable, 1 = request validation only, 2 = response validation only, 3 = both request & response validation  
**Default value:** 0 (no validation)  

### XMRESP for Custom Mock Responses
**Description:** Controls the type of mock responses generated.  
**Default value:** 1 (schema-valid mock responses)  
**Allowed values**: 0,1,2 where 0 = empty response body, 1 = dynamic schema-valid mock responses auto-generated from google discovery json schemas, 2 = custom business logic responses   

### XMDELAY for Mock Delays
**Description:** Introduces artificial delay in responses, to simulate network latency/timeouts.  
**Default value:** 0 (no delay)   

**Allowed values & formats:** 
- INTEGER = Fixed delay in milliseconds (e.g. `xmdelay=500` means 500ms delay)
- RANGE = Random delay between min-max milliseconds (e.g. `xmdelay=1000-3000` means random delay between 1000-3000ms), max allowed is 30000 ms
- RANDOM = Random delay upto max 30000 ms, autoselected by the system (e.g. `xmdelay=random`)
- TIMEOUT = Simulates connection timeout after max 30000 ms delay (e.g. `xmdelay=timeout`)
- PROBABILITY @RATE = Probability-based delay, default=100% when no rate is specified. Delay applied only when the probability condition is met via Math.random() check. (e.g. `xmdelay=500@30` means 30% chance of 500ms delay, `xmdelay=1000-3000@50` means 50% chance of random delay between 1000-3000ms, `xmdelay=random@20` means 20% chance of random delay, `xmdelay=timeout@10` means 10% chance of timeout). Check the response header `XMDELAY` to see if delay was applied or skipped for each request.

### XMERROR for Mock Errors
**Description:** Simulates mock errors in responses, to test error handling/retries.  
**Default value:** 0 (no error)  

**Allowed values & formats:** 
- INTEGER = Fixed HTTP error code between 400-599 (e.g. `xmerror=503` means always return HTTP 503 Service Unavailable)
- RANDOM = Returns random HTTP error code from [400, 401, 403, 404, 408, 409, 429, 500, 502, 503, 504] (e.g. `xmerror=random`)
- 4XX = Returns random HTTP error code from [400, 401, 403, 404, 405, 406, 408, 409, 410, 412, 413, 415, 416, 422, 428, 429, 431, 451] (e.g. `xmerror=4xx`)
- 5XX = Returns random HTTP error code from [500, 501, 502, 503, 504, 505, 507, 508, 509, 510, 511] (e.g. `xmerror=5xx`)
- AUTH = Returns random authentication/authorization error from [401,403] (e.g. `xmerror=auth`)
- QUOTA = Returns random quota/exceeded limit error from [429,509] (e.g. `xmerror=quota`)
- GATEWAY = Returns random gateway/network error from [502,503,504] (e.g. `xmerror=gateway`)
- CORRUPT = Returns corrupted/invalid response data (malformed JSON, unexpected HTML, random gibberish), HTTP 200 with corrupted content (e.g. `xmerror=corrupt`)
- CSV LIST = Comma-separated list of HTTP error codes (e.g. `xmerror=500,502,503` means randomly return one of the listed error codes)
- PROBABILITY @RATE = Probability-based error injection, default=100% when no rate is specified. Error applied only when the probability condition is met via Math.random() check. (e.g. `xmerror=503@20` means 20% chance of returning HTTP 503 error, `xmerror=random@30` means 30% chance of random error, `xmerror=4xx@10` means 10% chance of random 4xx error, `xmerror=5xx@15` means 15% chance of random 5xx error, `xmerror=auth@25` means 25% chance of random auth error, `xmerror=quota@5` means 5% chance of random quota error, `xmerror=gateway@40` means 40% chance of random gateway error, `xmerror=corrupt@15` means 15% chance of returning corrupted response data, `xmerror=400,503@20` means 20% chance of random error from listed error codes). Check the response header `XMERROR` to see if error was applied or skipped for each request.

### Combining options / Chaos testing
All the above options can be combined together for comprehensive mock simulations and chaos testing scenarios. You can set all parameters `XMDELAY` `XMERROR` `XMVAL` `XMRESP` together, via environment variables, command-line args, request headers, or query parameters. For example:

### Server-level config example
```bash
# Server-level config via environment variables, affects all requests, can be overridden by per-request config
export/set XMVAL=3
export/set XMRESP=1
export/set XMDELAY=1000-3000@30
export/set XMERROR=503@5
npx gapis-mock

# Server-level config via command-line args, affects all requests, can be overridden by per-request config
npx gapis-mock -- --xmval=3 --xmresp=1 --xmdelay=1000-3000@30 --xmerror=503@5
```
### Per-request config example
```bash
# Per-request config via headers, only affects this individual request
curl -H "XMVAL: 3" -H "XMRESP: 1" -H "XMDELAY: 1000-3000@30" -H "XMERROR: 503@5" "http://storagev1.localhost:3333/storage/v1/b/bucket1"

# Per-request config via query parameters, only affects this individual request
curl "http://storagev1.localhost:3333/storage/v1/b/bucket1?xmval=3&xmresp=1&xmdelay=1000-3000@30&xmerror=503@5"
```

When both server-level and per-request configurations are set, the per-request settings will override the server-level settings. 

Priority order (from highest to lowest):  
`Request Query Parameters > Request Headers > Command-line Args > Environment Variables > Default Values`

## Custom Business Logic
Set XMRESP=3 in server/request config and then add your custom business logic (using javascript) for any services/methods in the `routerManager.js` file in the `businessLogic()` function. This allows you to define specific behaviors, data manipulations, or response formats as per your requirements. Refer to the comments in the code for guidance on how to implement your custom logic.

## Usage Examples

### Using curl
```bash
# Direct simulator access :
curl "http://localhost:3333/storage/v1/b/bucket1" -H "xmservice: storage" -v

# DNS override : Using curl's --resolve flag
# Proxy must be running on port 443 for TLS termination
curl -k "https://storage.googleapis.com/storage/v1/b/bucket1" --resolve storage.googleapis.com:443:127.0.0.1 -v

# Via Proxy : Using -x flag (inline proxy specification)
curl -k "https://storage.googleapis.com/storage/v1/b/bucket1" -x http://localhost:3344 -v
```

### Using Node.js googleapis library
```javascript
// RootURL override
// simple code changes in client
const storage = google.storage({ version: 'v1' });
// specify rootUrl/headers/params for mock simulator
let overrides = { rootUrl: 'http://127.0.0.1:3333/', headers: { xmservice: 'storage' }, params: { xmval: '1', xmresp: '1', xmdelay: '500', xmerror: '0' } };
// use the overrides in the API call, can also set them globally in google/google.storage if supported, try it out & let me know
const res = await storage.buckets.list({ project: 'my-test-project' }, overrides);
console.log(res,res.data);


// Proxy mode (set environment variables)
// set environment variables 
// HTTP_PROXY=http://localhost:3344 HTTPS_PROXY=http://localhost:3344 NO_PROXY=localhost,127.0.0.1,::1 NODE_TLS_REJECT_UNAUTHORIZED=0
// no code changes needed in client
// all *.googleapis.com requests will go via proxy to simulator
// you can pass optional simulator settings via headers/params normally
let overrides = { headers: { xmval: '1', xmresp: '1' }, params: { xmdelay: '500', xmerror: '0' } };
const res = await storage.buckets.list({ project: 'my-test-project' }, overrides);
console.log(res,res.data);


// DNS override (set hosts file entry)
// add '127.0.0.1 storage.googleapis.com' entry to your hosts file (one entry for each service)
// set environment variable NODE_TLS_REJECT_UNAUTHORIZED=0
// run local MITM proxy on port 443 for TLS termination
// all storage.googleapis.com requests will go via DNS to proxy to simulator
// no code changes needed in client
// you can pass optional simulator settings via headers/params normally
let overrides = { headers: { xmval: '1', xmresp: '1' }, params: { xmdelay: '500', xmerror: '0' } };
const res = await storage.buckets.list({ project: 'my-test-project' }, overrides);
console.log(res,res.data);
```

### Using PHP google-api-php-client

```php
// composer require google/apiclient
require_once './vendor/autoload.php';
// ---- CLIENT SETUP ----
$client = new Google_Client();
$client->setDeveloperKey('dummy'); // Not used by mock, but required
// ---- PROXY MODE ----
// Set proxy for all requests
$client->setHttpClient(
    new GuzzleHttp\Client([
        'proxy' => 'http://localhost:3344', // Your local proxy address
        'verify' => false, // Disable SSL verification for local proxy
        'debug' => true, // Enable debug to see request details
        // Optional custom headers/query params to control mock server behavior
		'query' => [
            'xmval' => '2',
            'xmresp' => '1',
        ],
        'headers' => [
            'xmval' => '3',
            'xmresp' => '1',
            'xmdelay' => '500',
            'xmerror' => '0',
        ],
    ])
);
$service = new Google_Service_Storage($client);
// $result = $service->buckets->listBuckets('test-project');
$result = $service->buckets->get('test-bucket');
echo "PROXY MODE RESULT:\n";
echo json_encode($result instanceof \Google\Model ? $result->toSimpleObject() : $result, JSON_PRETTY_PRINT);

// ---- DNS OVERRIDE MODE ----
// Add 127.0.0.1 storage.googleapis.com to /etc/hosts or C:\Windows\System32\drivers\etc\hosts or equivalent
// NOTE - Per service entry needed in hosts file
// Run the proxy on port 443 (the proxy handles TLS termination)
// Disable SSL verification for local proxy OR install/trust the local proxy's CA certificate in your system
// Run the php program normally
?>
```

### Using Python google-api-python-client
```python
# Proxy mode
# simple code changes needed in client
import httplib2, socks, json
from googleapiclient.discovery import build
httplib2.debuglevel = 4 # enable debug logging
# add proxy info
proxy_info = httplib2.ProxyInfo( socks.PROXY_TYPE_HTTP, '127.0.0.1', 3344 )
http = httplib2.Http(proxy_info=proxy_info, disable_ssl_certificate_validation=True)
# use the http with proxy in the client
service = build( 'storage', 'v1', developerKey='dummy', http=http )
req = service.buckets().list(project='test-project')
# set optional simulator settings via request headers/params, as needed
req.headers.update({'xmval': '1', 'xmresp': '1', 'xmdelay': '500', 'xmerror': '0'})
result = req.execute()
print("Result:", json.dumps(result, indent=2, default=str) if isinstance(result, dict) else result)

# Proxy mode (set env vars, disable tls/trust CA, refer Nodejs example)
# DNS override (set hosts file entry, refer Nodejs example)
# RootURL override (code changes needed in client, need to test)
```

### Using Go google-api-go-client
```go
// Proxy mode 1
// no code changes needed in client
// set environment variables as below before running the client
// HTTP_PROXY=http://localhost:3344 HTTPS_PROXY=http://localhost:3344 NO_PROXY=localhost,127.0.0.1,::1 
// SSL_CERT_FILE=/path/to/proxy-root-ca.crt // check local proxy's console log to find location of generated CA cert
// run your Go client code as usual
// all *.googleapis.com requests will go via proxy to simulator
// you can pass optional simulator settings via request headers/params normally (see example below)

// Proxy mode 2
// simple changes needed in client
package main
import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
)
// export GODEBUG=http2debug=2,httpprof=1
func main() {
	// Create a custom HTTP client that points to your local proxy
	proxyURL, _ := url.Parse("http://localhost:3344")
	httpClient := &http.Client{
		Transport: &http.Transport{
			Proxy: http.ProxyURL(proxyURL),
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: true, // disable SSL verification for dev/testing
			},
		},
	}
	srv, err := drive.NewService(context.Background(),
		option.WithHTTPClient(httpClient),
	)
	if err != nil {
		log.Fatalf("Unable to create Drive client: %+v", err)
		panic(err)
	}
	// Example: List files
	call := srv.Files.List().PageSize(10).Fields("files(id, name)")
    // set optional simulator settings via headers/query params as needed
	call.Header().Set("XMVAL", "3")
    call.Header().Set("XMRESP", "1")
    call.Header().Set("XMDELAY", "1000")
    call.Header().Set("XMERROR", "400@1")
	r, err := call.Do() // Use .Do() to execute the API call
	if err != nil {
		log.Fatalf("Unable to retrieve files: %+v", err)
		panic(err)
	}
	// Print response headers
	fmt.Println("----- RESPONSE HEADERS -----")
	for k, v := range r.ServerResponse.Header {
		fmt.Printf("%s: %s\n", k, v)
	}
	// Print the full JSON response
	fmt.Println("----- FULL JSON RESPONSE -----")
	jsonBytes, _ := json.MarshalIndent(r, "", "  ")
	fmt.Println(string(jsonBytes))
	fmt.Println("Files:")
	if len(r.Files) == 0 {
		fmt.Println("No files found.")
	} else {
		for _, i := range r.Files {
			fmt.Printf("%s (%s)\n", i.Name, i.Id)
		}
	}
}

// DNS override (refer Nodejs example)
// RootURL override (code changes needed in client, need to test)
```
### All other clients/libraries/SDKs/CLIs/tools
- Use either Proxy mode, DNS override, or RootURL override to point to the mock simulator, refer Usage examples
- Set optional simulator options via request headers or query parameters as needed (XMVAL, XMRESP, XMDELAY, XMERROR)
- Please report your findings/issues/workarounds for each client/library/SDK/CLI/tool to help improve integration with more clients, contact us via [Support](#support) section

## Project Structure & Components
- `simulator.js` - Starts the mock server, handles config/middleware, request parsing, global/special endpoints, etc
- `routerManager.js` - Manages dynamic routing, schema validation, mock delays, errors, responses, etc
- `mockGenerator.js` - Generates mock data based on JSON schemas
- `loadData.js` - Loads and caches files from "data.zip" archive
- `proxy.js` - Local MITM proxy server that intercepts and forwards requests to the mock simulator
- `data.zip` - Contains pregenerated router-specs, json-schemas for validations, list of all Google API services & names to use, proxy mapping from hostname/headers/path to actual services, all discovery documents, api directory, etc
- `package.json` - Project metadata and dependencies

## Support

- Issues: [gapis-mock/issues](https://github.com/cloud26apps/gapis-mock/issues)
- Discussions: [gapis-mock/discussions](https://github.com/cloud26apps/gapis-mock/discussions)
- Email: [cloud26apps] [@@@] [gmail.com]
- Repository: [gapis-mock](https://github.com/cloud26apps/gapis-mock)

## Disclaimer

Not affiliated with or endorsed by Google. For local dev/testing only.

## License

Apache License 2.0 - See [LICENSE](./LICENSE) file for details
