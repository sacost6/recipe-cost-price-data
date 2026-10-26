const REQUEST_TIMEOUT_MS = 10_000;

export class KrogerUpstreamError extends Error {
  constructor(stage, statusCode = 502) {
    super(`Kroger ${stage} failed.`);
    this.name = "KrogerUpstreamError";
    this.statusCode = statusCode;
    this.stage = stage;
  }
}

const requiredString = (value, fieldName) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new KrogerUpstreamError(`location response (${fieldName})`);
  }
  return value.trim();
};

const optionalString = (value, fieldName) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new KrogerUpstreamError(`location response (${fieldName})`);
  }
  return value.trim() || null;
};

const normalizeLocations = (payload) => {
  if (!payload || !Array.isArray(payload.data)) {
    throw new KrogerUpstreamError("location response parsing");
  }

  return payload.data.map((location) => {
    const address = location?.address;
    if (!address || typeof address !== "object") {
      throw new KrogerUpstreamError("location response parsing");
    }

    const stateCode = requiredString(address.state, "state");
    if (stateCode.length !== 2) {
      throw new KrogerUpstreamError("location response parsing");
    }

    return {
      locationId: requiredString(location.locationId, "locationId"),
      name: requiredString(location.name, "name"),
      chain: requiredString(location.chain, "chain"),
      storeNumber: optionalString(location.storeNumber, "storeNumber"),
      addressLine1: requiredString(address.addressLine1, "addressLine1"),
      addressLine2: optionalString(address.addressLine2, "addressLine2"),
      city: requiredString(address.city, "city"),
      stateCode,
      postalCode: optionalString(address.zipCode, "zipCode"),
    };
  });
};

const getAccessToken = async ({ config, fetcher, scope }) => {
  if (!config.clientId || !config.clientSecret) {
    const error = new Error("Kroger API credentials are not configured.");
    error.statusCode = 503;
    throw error;
  }

  const credentials = Buffer.from(
    `${config.clientId}:${config.clientSecret}`,
  ).toString("base64");
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  if (scope) body.set("scope", scope);

  let response;
  try {
    response = await fetcher(config.tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new KrogerUpstreamError("token request");
  }

  if (!response.ok) throw new KrogerUpstreamError("token request");

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new KrogerUpstreamError("token response parsing");
  }

  if (typeof payload?.access_token !== "string" || !payload.access_token) {
    throw new KrogerUpstreamError("token response parsing");
  }
  return payload.access_token;
};

const getKrogerResponse = async ({ url, token, fetcher, stage }) => {
  let response;
  try {
    response = await fetcher(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new KrogerUpstreamError(stage);
  }
  if (!response.ok) throw new KrogerUpstreamError(stage);

  try {
    return await response.json();
  } catch {
    throw new KrogerUpstreamError(`${stage} response parsing`);
  }
};

export const searchLocations = async ({
  zipCode,
  radiusInMiles,
  config,
  fetcher = globalThis.fetch,
}) => {
  const token = await getAccessToken({ config, fetcher });
  const url = new URL(`${config.apiBaseUrl.replace(/\/$/, "")}/v1/locations`);
  url.searchParams.set("filter.zipCode.near", zipCode);
  url.searchParams.set("filter.radiusInMiles", String(radiusInMiles));
  url.searchParams.set("filter.limit", "200");
  const payload = await getKrogerResponse({
    url,
    token,
    fetcher,
    stage: "location request",
  });
  return normalizeLocations(payload);
};

export const getProduct = async ({
  upc,
  locationId,
  config,
  fetcher = globalThis.fetch,
}) => {
  const token = await getAccessToken({
    config,
    fetcher,
    scope: "product.compact",
  });
  const url = new URL(
    `${config.apiBaseUrl.replace(/\/$/, "")}/v1/products/${encodeURIComponent(upc)}`,
  );
  url.searchParams.set("filter.locationId", locationId);
  return getKrogerResponse({
    url,
    token,
    fetcher,
    stage: "product request",
  });
};
