const fs = require("fs");
try {
  console.log("undici_version=" + require("undici/package.json").version);
} catch (e) {
  console.log("undici_pkg_fail=" + e.message);
}
try {
  require("undici");
  console.log("undici_load=ok");
} catch (e) {
  console.log("undici_load_fail=" + String(e.message || e).slice(0, 300));
}
try {
  require("esbuild");
  console.log("esbuild_load=ok");
} catch (e) {
  console.log("esbuild_load_fail=" + String(e.message || e).slice(0, 200));
}
console.log(
  "root_nm=" + fs.existsSync("node_modules"),
  "web_nm=" + fs.existsSync("apps/web/node_modules"),
  "mobile_nm=" + fs.existsSync("apps/mobile/node_modules"),
  "lock=" + fs.existsSync("pnpm-lock.yaml")
);
