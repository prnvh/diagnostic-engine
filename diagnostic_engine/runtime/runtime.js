const { buildConfig, loadEnvFile } = require("./config");
const { loadRegistry } = require("../core/registry/loader");
const { loadAndValidateRegistry } = require("../core/registry/validate");
const { createServices } = require("../http/routes");

let servicesPromise = null;

async function getServices({ reload = false } = {}) {
  loadEnvFile();

  if (!servicesPromise || reload) {
    servicesPromise = (async () => {
      const config = buildConfig();
      loadAndValidateRegistry();
      const registry = loadRegistry();
      return createServices({ registry, config });
    })().catch((error) => {
      servicesPromise = null;
      throw error;
    });
  }

  return servicesPromise;
}

module.exports = {
  getServices
};
