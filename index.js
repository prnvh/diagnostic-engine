const { buildConfig, loadEnvFile } = require("./lib/config");
const { createServer, createServices } = require("./api/routes");
const { loadRegistry } = require("./registry/loader");
const { loadAndValidateRegistry } = require("./registry-validator/validate");

async function main() {
  loadEnvFile();
  const config = buildConfig();
  loadAndValidateRegistry();
  const registry = loadRegistry();
  const services = await createServices({ registry, config });
  const server = createServer(services);

  server.listen(config.port, () => {
    console.log(`Diagnostic engine listening on http://localhost:${config.port}`);
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  main
};
