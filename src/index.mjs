import { createKrogerServer } from "./server.mjs";

// Create custom Kroger service server instance and start listening for requests.
// The server will exit on SIGTERM or SIGINT signals.
const server = createKrogerServer();
const port = Number(process.env.PORT ?? 3001);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port.");
}
// Check internal bearer token for requests to this service.
if (!process.env.KROGER_SERVICE_TOKEN) {
  throw new Error("KROGER_SERVICE_TOKEN must be configured.");
}

// Listen on all interfaces to allow access from Docker container network.
server.listen(port, "0.0.0.0", () => {
  console.info(`Kroger service listening on port ${port}.`);
});

// Gracefully shutdown the server on SIGTERM or SIGINT signals.
const shutdown = () => {
  server.close(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
