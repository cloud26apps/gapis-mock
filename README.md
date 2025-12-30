# gapis-mock
Mock server for all Google APIs, for local dev/testing. Based on Google discovery documents.

## Features

- **Complete Google APIs mocking** - Mocks all Google API services based on Google discovery documents
- **Request/Response Validation** - Schema-based validation of requests/responses using JSON schemas (mapped from Google Discovery documents)
- **Mock Responses** - Generates mock responses based on JSON schemas (schema-valid, dynamic, fake), can be easily customized with businessLogic or stateful persistent simulated high-fidelity responses. (Requires time & effort)
- **Mock Delays** - Configurable request delays for realistic testing
- **Mock Errors** - Simulate error scenarios and edge cases
- **Chaos Testing** - Test application resilience with controlled failure modes
- **Local MITM Proxy** - Transparent proxy for intercepting googleapis.com requests without code changes
- **Zero Configuration** - Works out of the box with existing googleapis clients/libraries/SDKs/CLIs/tools
- **Development & CI Ready** - Perfect for local development, integration testing, and CI/CD pipelines

## Requirements

- Node.js >= 20.0.0
- npm or yarn

## Installation

### Via npm

```bash
npm install -g gapis-mock
```

### Via git

```bash
git clone https://github.com/cloud26apps/gapis-mock.git
cd gapis-mock
npm install
```

## Quick Start

### 1. Start the Mock Simulator

```bash
npm run gapis-mock
# or
node simulator.js
```

The mock server starts on `http://localhost:8080`

### 2. Start the MITM Proxy (Optional)

```bash
npm run gapis-proxy
# or
node proxy.js
```

The proxy intercepts requests to `*.googleapis.com` and forwards them to the mock simulator.

## Usage Examples

### Using with Node.js googleapis library

```javascript
const {google} = require('googleapis');

const compute = google.compute({
  version: 'v1',
  baseURL: 'http://localhost:8080'
});

// Or with proxy (no code changes needed)
process.env.https_proxy = 'http://localhost:8888';
const compute = google.compute('v1');
```

### Using with curl

```bash
# Direct simulator
curl http://localhost:8080/compute/v1/projects/my-project/zones/us-central1-a/instances

# Via proxy
https_proxy=http://localhost:8888 curl https://www.googleapis.com/compute/v1/projects/my-project/zones/us-central1-a/instances
```

## Configuration

### Mock Delays

Add `xmdelay` query parameter (in milliseconds):

```bash
curl 'http://localhost:8080/compute/v1/projects/my-project?xmdelay=5000'
```

### Mock Errors

Add `xmerror` query parameter:

```bash
curl 'http://localhost:8080/compute/v1/projects/my-project?xmerror=404'
```

### Custom Mock Responses

Add `xmresp` header to use custom response templates or stateful responses.

### Request/Response Validation

Validation is enabled by default. Add `xmval=skip` to bypass:

```bash
curl 'http://localhost:8080/compute/v1/projects/my-project?xmval=skip'
```

## Supported Services

All Google API services from the official Google Discovery Directory are supported, including:

- Compute Engine (compute)
- Cloud Storage (storage)
- Cloud BigQuery (bigquery)
- Cloud Pub/Sub (pubsub)
- Cloud Firestore (firestore)
- Google Drive (drive)
- Google Sheets (sheets)
- Google Calendar (calendar)
- Cloud IAM (iam)
- Cloud Resource Manager (cloudresourcemanager)
- And 200+ more...

## Architecture

- **simulator.js** - Main Express server handling requests, validation, and mock data generation
- **routerManager.js** - Dynamic routing, AJV schema validation, delays, errors, and business logic
- **mockGenerator.js** - Mock data generation based on JSON schemas
- **loadData.js** - Loads and caches API specs from data.zip
- **proxy.js** - Local MITM proxy with TLS termination and DNS overrides

## Project Files

- `data/serviceslist.json` - All available Google services with metadata
- `data/{service}_s.json` - Pre-generated router specifications
- `data/{service}_v.json` - Pre-generated JSON schemas for validation
- `data.zip` - Compressed archive of all data files

## Development

### Code Guidelines

- Modular, extensible, and scalable architecture
- Simple, concise, human-readable code
- Modern JavaScript (async/await, ES modules)
- Proper error handling and no blocking operations
- Industry best practices for security, performance, and reliability

### Building from Source

```bash
# Install dependencies
npm install

# Fetch latest Google API discovery documents
node getindex.js

# Generate specs, validators, and data.zip
node getspecs.js

# Run tests
npm run test
```

## API Reference

### Health Check

```bash
GET /health
```

### Service List

```bash
GET /services
```

### API Endpoint

```
{method} /{service}/{version}/{resource}
```

Example:
```bash
GET http://localhost:8080/compute/v1/projects/my-project/zones
POST http://localhost:8080/storage/v1/b/my-bucket/o
```

## Query Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `xmdelay` | Add delay in milliseconds | `?xmdelay=5000` |
| `xmerror` | Return error with status code | `?xmerror=503` |
| `xmval` | Validation mode (skip/strict) | `?xmval=skip` |
| `xmresp` | Custom response behavior | `?xmresp=proxy` |

## Request Headers

| Header | Description |
|--------|-------------|
| `xmservice` | Override service endpoint |
| `Authorization` | Passed through (no validation) |

## Limitations & Future Work

- Batch request support (batchPath)
- Streaming and resumable media uploads
- Full authentication/authorization/IAM/scopes
- gRPC and gRPC-JSON transcoding
- Advanced stateful response handling

## Testing

Works with existing googleapis clients and libraries for:

- Node.js
- Python
- Go
- Java
- JavaScript/Web
- cURL
- gcloud CLI
- Terraform
- gsutil
- Android/iOS
- PHP
- .NET

## License

Apache License 2.0 - See LICENSE file for details

## Contributing

Contributions are welcome! Please open issues and pull requests on GitHub.

## Support

- GitHub Issues: [gapis-mock/issues](https://github.com/cloud26apps/gapis-mock/issues)
- Repository: [gapis-mock](https://github.com/cloud26apps/gapis-mock)

## Disclaimer

This project is **NOT AFFILIATED WITH GOOGLE**. It is an independent mock server for testing and development purposes.

## Author

Cloud26apps
