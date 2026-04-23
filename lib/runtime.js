const { buildConfig, loadEnvFile } = require("./config");
const { loadRegistry } = require("../registry/loader");
const { loadAndValidateRegistry } = require("../registry-validator/validate");
const { createServices } = require("../server/routes");

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
