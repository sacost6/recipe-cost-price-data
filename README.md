# Kroger service

This internal HTTP service owns Kroger API credentials and makes transient
location and UPC product requests. It does not store or log Kroger product
responses. The backend proxies authenticated requests to it.

## Local setup

1. Copy `.env.example` to `.env.dev` and set `KROGER_CLIENT_ID` and
   `KROGER_CLIENT_SECRET` there.
2. Set `KROGER_SERVICE_TOKEN` in the repository root `.env` file. Compose gives
   the same token to the Kroger service and backend.
3. Run `docker compose up --build` from the repository root.

The service is available only on the Compose network. The backend product
lookup endpoint is `GET /api/kroger/products/:upc?locationId=...`; it requires
the usual backend session authentication and marks the response `no-store`.
Location lookup remains at
`GET /api/store-locations/kroger/search?zipCode=...&radiusInMiles=...`.

For deployment, provide a strong shared `KROGER_SERVICE_TOKEN` through the
deployment secret manager and provide Kroger credentials only to this service.
The recurring price sync worker was removed; these lookup responses are not
written to application storage.
