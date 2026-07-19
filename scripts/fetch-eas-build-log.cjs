const { spawnSync } = require("child_process");
const https = require("https");
const http = require("http");
const fs = require("fs");

const buildId = process.argv[2] || "269f04b4-be5b-4dc3-95a2-1077535d8e0a";
const view = spawnSync(
  "eas",
  ["build:view", buildId, "--json"],
  { encoding: "utf8", maxBuffer: 10_000_000 }
);
if (view.status !== 0) {
  console.error("eas build:view failed", view.stderr || view.stdout);
  process.exit(1);
}
const data = JSON.parse(view.stdout);
const url = (data.logFiles && data.logFiles[0]) || "";
if (!url) {
  console.error("no logFiles");
  process.exit(1);
}
const out = "/tmp/mmd-eas-build.log";
const client = url.startsWith("https") ? https : http;
client
  .get(url, (res) => {
    const chunks = [];
    res.on("data", (c) => chunks.push(c));
    res.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      fs.writeFileSync(out, text);
      const lines = text.split(/\r?\n/);
      const hits = lines.filter((l) =>
        /error|Error|Unable|failed|Module not found|SyntaxError|TypeError|ENOENT/i.test(
          l
        )
      );
      console.log(`log_bytes=${text.length} hit_lines=${hits.length}`);
      console.log(hits.slice(-80).join("\n"));
    });
  })
  .on("error", (e) => {
    console.error(e.message);
    process.exit(1);
  });
