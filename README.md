# Kroger service

This internal HTTP service owns Kroger API credentials and makes transient
location, product search, and UPC lookup requests. It does not store or log
Kroger product responses. The backend proxies authenticated requests to it.

## Local setup

1. Copy `.env.example` to `.env.dev` and set `KROGER_CLIENT_ID` and
   `KROGER_CLIENT_SECRET` there.
2. Set `KROGER_SERVICE_TOKEN` in the repository root `.env.dev` file. Compose
   passes that same value to the Kroger service and backend.
3. Run `docker compose up --build` from the repository root.

The service is available only on the Compose network. The backend product
search endpoint is `GET /api/kroger/products/search?term=...&locationId=...`;
the UPC lookup endpoint is `GET /api/kroger/products/:upc?locationId=...`.
Both require the usual backend session authentication and mark responses
`no-store`. Location lookup remains at
`GET /api/store-locations/kroger/search?zipCode=...&radiusInMiles=...`.

For deployment, provide a strong shared `KROGER_SERVICE_TOKEN` through the
deployment secret manager and provide Kroger credentials only to this service.
The recurring price sync worker was removed. Selecting a search result in the
product form saves its returned package price as a Kroger price observation;
other search results remain transient.
