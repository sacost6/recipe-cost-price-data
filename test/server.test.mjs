import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createKrogerServer } from "../src/server.mjs";

const token = "test-internal-token";
const config = {
  port: 0,
  serviceToken: token,
  clientId: "test-client",
  clientSecret: "test-secret",
  apiBaseUrl: "https://api.kroger.test",
  tokenUrl: "https://api.kroger.test/token",
};

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status });

const withHandler = async (options, callback) => {
  const server = createKrogerServer({
    config,
    logger: { error() {} },
    ...options,
  });
  const handler = server.listeners("request")[0];
  await callback(async (path, authorization = `Bearer ${token}`) => {
    let statusCode;
    let responseHeaders;
    let responseBody;
    const request = {
      method: "GET",
      url: path,
      headers: authorization ? { authorization } : {},
    };
    const response = {
      writeHead(status, headers) {
        statusCode = status;
        responseHeaders = headers;
      },
      end(body) {
        responseBody = body;
      },
    };
    await handler(request, response);
    return {
      status: statusCode,
      headers: responseHeaders,
      json: () => JSON.parse(responseBody),
    };
  });
};

describe("Kroger microservice", () => {
  it("requires its internal service token for lookup endpoints", async () => {
    await withHandler(
      { fetcher: async () => assert.fail("upstream should not be called") },
      async (request) => {
        const response = await request("/v1/locations?zipCode=60601", "");
        assert.equal(response.status, 401);
        assert.deepEqual(response.json(), {
          status: "error",
          message: "Unauthorized.",
        });
      },
    );
  });

  it("searches locations and returns the normalized location result", async () => {
    const calls = [];
    const fetcher = async (url, options) => {
      calls.push({ url: String(url), options });
      if (calls.length === 1) {
        return jsonResponse({ access_token: "upstream-token" });
      }
      return jsonResponse({
        data: [
          {
            locationId: "01400390",
            name: "Kroger Marketplace",
            chain: "KROGER",
            storeNumber: "00390",
            address: {
              addressLine1: "123 Main St",
              addressLine2: null,
              city: "Chicago",
              state: "IL",
              zipCode: "60601",
            },
          },
        ],
      });
    };

    await withHandler({ fetcher }, async (request) => {
      const response = await request(
        "/v1/locations?zipCode=60601&radiusInMiles=25",
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers["cache-control"], "no-store");
      assert.deepEqual(response.json(), {
        status: "success",
        data: [
          {
            locationId: "01400390",
            name: "Kroger Marketplace",
            chain: "KROGER",
            storeNumber: "00390",
            addressLine1: "123 Main St",
            addressLine2: null,
            city: "Chicago",
            stateCode: "IL",
            postalCode: "60601",
          },
        ],
      });
    });

    assert.equal(calls.length, 2);
    assert.match(
      calls[0].options.body.toString(),
      /grant_type=client_credentials/,
    );
    const locationUrl = new URL(calls[1].url);
    assert.equal(locationUrl.searchParams.get("filter.zipCode.near"), "60601");
    assert.equal(locationUrl.searchParams.get("filter.radiusInMiles"), "25");
    assert.equal(
      calls[1].options.headers.Authorization,
      "Bearer upstream-token",
    );
  });

  it("forwards product data without interpreting or persisting it", async () => {
    const productPayload = {
      data: {
        items: [
          {
            itemId: "0001234567890",
            price: { regular: 4.99, promo: 3.99 },
            size: "1 gal",
          },
        ],
      },
    };
    const calls = [];
    const fetcher = async (url, options) => {
      calls.push({ url: String(url), options });
      return calls.length === 1
        ? jsonResponse({ access_token: "upstream-token" })
        : jsonResponse(productPayload);
    };

    await withHandler({ fetcher }, async (request) => {
      const response = await request(
        "/v1/products/0001234567890?locationId=01400390",
      );
      assert.equal(response.status, 200);
      assert.deepEqual(response.json(), {
        status: "success",
        data: productPayload,
      });
    });

    const tokenBody = calls[0].options.body.toString();
    assert.match(tokenBody, /scope=product\.compact/);
    const productUrl = new URL(calls[1].url);
    assert.equal(productUrl.pathname, "/v1/products/0001234567890");
    assert.equal(productUrl.searchParams.get("filter.locationId"), "01400390");
    assert.equal(
      calls[1].options.headers.Authorization,
      "Bearer upstream-token",
    );
  });

  it("rejects invalid ZIP and product lookup parameters before upstream calls", async () => {
    let upstreamCalls = 0;
    const fetcher = async () => {
      upstreamCalls++;
      return jsonResponse({});
    };

    await withHandler({ fetcher }, async (request) => {
      const badZip = await request("/v1/locations?zipCode=Chicago");
      const badProduct = await request(
        "/v1/products/not-a-upc?locationId=01400390",
      );
      const badLocation = await request(
        "/v1/products/0001234567890?locationId=bad%20id",
      );
      assert.equal(badZip.status, 400);
      assert.equal(badProduct.status, 400);
      assert.equal(badLocation.status, 400);
    });

    assert.equal(upstreamCalls, 0);
  });

  it("returns a generic upstream error without exposing Kroger response details", async () => {
    const fetcher = async () =>
      new Response("secret provider detail", { status: 503 });

    await withHandler({ fetcher }, async (request) => {
      const response = await request("/v1/locations?zipCode=60601");
      assert.equal(response.status, 502);
      assert.deepEqual(response.json(), {
        status: "error",
        message: "Unable to contact Kroger right now.",
      });
    });
  });
});
