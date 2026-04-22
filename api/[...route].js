const { getServices } = require("../lib/runtime");
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

module.exports = async function vercelHandler(request, response) {
  const handler = await getHandler();
  return handler(request, response);
};
