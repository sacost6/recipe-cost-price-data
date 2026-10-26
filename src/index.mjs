import { createKrogerServer } from "./server.mjs";

const server = createKrogerServer();
const port = Number(process.env.PORT ?? 3001);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port.");
}
if (!process.env.KROGER_SERVICE_TOKEN) {
  throw new Error("KROGER_SERVICE_TOKEN must be configured.");
}

server.listen(port, "0.0.0.0", () => {
  console.info(`Kroger service listening on port ${port}.`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
