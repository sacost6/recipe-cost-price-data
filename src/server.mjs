import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import {
  getProduct,
  KrogerUpstreamError,
  searchLocations,
  searchProducts,
} from "./kroger-api.mjs";

const json = (response, statusCode, body) => {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
};

const tokenMatches = (provided, expected) => {
  if (!provided || !expected) return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
};

const parseLocationQuery = (url) => {
  const zipCode = (url.searchParams.get("zipCode") ?? "").trim();
  if (!/^\d{5}(?:-\d{4})?$/.test(zipCode)) {
    return { error: "Enter a valid US ZIP code." };
  }

  const radiusValue = url.searchParams.get("radiusInMiles");
  const radiusInMiles = radiusValue === null ? 10 : Number(radiusValue);
  if (
    !Number.isInteger(radiusInMiles) ||
    radiusInMiles < 1 ||
    radiusInMiles > 100
  ) {
    return { error: "Search radius must be an integer from 1 to 100 miles." };
  }
  return { zipCode, radiusInMiles };
};

const parseProductSearchQuery = (url) => {
  const term = (url.searchParams.get("term") ?? "").trim();
  if (
    term.length < 2 ||
    term.length > 100 ||
    term.split(/\s+/).length > 8
  ) {
    return { error: "Enter a product search with 2 to 100 characters." };
  }

  const locationId = (url.searchParams.get("locationId") ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,30}$/.test(locationId)) {
    return { error: "Enter a valid Kroger location ID." };
  }
  return { term, locationId };
};

const errorResponse = (error, logger) => {
  if (error?.statusCode === 503) {
    return {
      statusCode: 503,
      message: "Kroger API credentials are not configured.",
    };
  }
  if (error instanceof KrogerUpstreamError) {
    logger.error?.({ stage: error.stage }, "Kroger upstream request failed");
    return {
      statusCode: error.statusCode ?? 502,
      message: "Unable to contact Kroger right now.",
    };
  }
  logger.error?.(
    { errorType: error?.name ?? "UnknownError" },
    "Kroger service request failed",
  );
  return { statusCode: 502, message: "Unable to complete the Kroger request." };
};

export const createKrogerServer = ({
  config = {
    port: Number(process.env.PORT ?? 3001),
    serviceToken: process.env.KROGER_SERVICE_TOKEN,
    clientId: process.env.KROGER_CLIENT_ID,
    clientSecret: process.env.KROGER_CLIENT_SECRET,
    apiBaseUrl: process.env.KROGER_API_BASE_URL ?? "https://api.kroger.com",
    tokenUrl:
      process.env.KROGER_TOKEN_URL ??
      `${process.env.KROGER_API_BASE_URL ?? "https://api.kroger.com"}/v1/connect/oauth2/token`,
  },
  fetcher = globalThis.fetch,
  logger = console,
} = {}) =>
  createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://kroger-service");

    if (request.method === "GET" && url.pathname === "/healthz") {
      return json(response, 200, { status: "ok" });
    }

    if (request.method !== "GET") {
      return json(response, 405, {
        status: "error",
        message: "Method not allowed.",
      });
    }

    const authorization = request.headers.authorization ?? "";
    const suppliedToken = authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    if (!tokenMatches(suppliedToken, config.serviceToken)) {
      return json(response, 401, { status: "error", message: "Unauthorized." });
    }

    if (url.pathname === "/v1/locations") {
      const parsed = parseLocationQuery(url);
      if (parsed.error) {
        return json(response, 400, { status: "error", message: parsed.error });
      }
      try {
        const data = await searchLocations({ ...parsed, config, fetcher });
        return json(response, 200, { status: "success", data });
      } catch (error) {
        const mapped = errorResponse(error, logger);
        return json(response, mapped.statusCode, {
          status: "error",
          message: mapped.message,
        });
      }
    }

    if (url.pathname === "/v1/products/search") {
      const parsed = parseProductSearchQuery(url);
      if (parsed.error) {
        return json(response, 400, { status: "error", message: parsed.error });
      }
      try {
        const data = await searchProducts({ ...parsed, config, fetcher });
        return json(response, 200, { status: "success", data });
      } catch (error) {
        const mapped = errorResponse(error, logger);
        return json(response, mapped.statusCode, {
          status: "error",
          message: mapped.message,
        });
      }
    }

    const productMatch = url.pathname.match(/^\/v1\/products\/([^/]+)$/);
    if (productMatch) {
      const upc = productMatch[1];
      const locationId = (url.searchParams.get("locationId") ?? "").trim();
      if (!/^\d{1,20}$/.test(upc)) {
        return json(response, 400, {
          status: "error",
          message: "Enter a valid product UPC.",
        });
      }
      if (!/^[A-Za-z0-9_-]{1,30}$/.test(locationId)) {
        return json(response, 400, {
          status: "error",
          message: "Enter a valid Kroger location ID.",
        });
      }
      try {
        const data = await getProduct({ upc, locationId, config, fetcher });
        return json(response, 200, { status: "success", data });
      } catch (error) {
        const mapped = errorResponse(error, logger);
        return json(response, mapped.statusCode, {
          status: "error",
          message: mapped.message,
        });
      }
    }

    return json(response, 404, {
      status: "error",
      message: "Route not found.",
    });
  });
