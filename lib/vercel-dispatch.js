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
}

module.exports = {
  dispatchToHandler
};
