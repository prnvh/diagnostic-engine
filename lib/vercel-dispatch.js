const { getServices } = require("./runtime");
const { createRequestHandler } = require("../server/routes");

let handlerPromise = null;

async function getHandler() {
  if (!handlerPromise) {
    handlerPromise = getServices()
      .then((services) => createRequestHandler(services))
      .catch((error) => {
        handlerPromise = null;
        throw error;
      });
  }

  return handlerPromise;
}

async function dispatchToHandler(request, response, urlOverride) {
  try {
    const handler = await getHandler();
    const originalUrl = request.url;

    if (urlOverride) {
      request.url = urlOverride;
    }

    try {
      return await handler(request, response);
    } finally {
      request.url = originalUrl;
    }
  } catch (error) {
    if (!response.headersSent) {
      response.statusCode = 500;
      response.setHeader("access-control-allow-origin", "*");
      response.setHeader("cache-control", "no-store");
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(
        JSON.stringify(
          {
            error: error.message || "Serverless function initialization failed"
          },
          null,
          2
        )
      );
      return;
    }

    throw error;
  }
}

module.exports = {
  dispatchToHandler
};
