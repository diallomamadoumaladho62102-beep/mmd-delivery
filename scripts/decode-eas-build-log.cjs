const fs = require("fs");
const zlib = require("zlib");
const { spawnSync } = require("child_process");
const https = require("https");

const buildId = process.argv[2] || "269f04b4-be5b-4dc3-95a2-1077535d8e0a";
const view = spawnSync("eas", ["build:view", buildId, "--json"], {
  encoding: "utf8",
  maxBuffer: 10_000_000,
});
const data = JSON.parse(view.stdout);
const url = data.logFiles[0];

https
  .get(url, (res) => {
    const chunks = [];
    res.on("data", (c) => chunks.push(c));
    res.on("end", () => {
      const buf = Buffer.concat(chunks);
      let text;
      try {
        text = zlib.gunzipSync(buf).toString("utf8");
      } catch {
        try {
          text = zlib.inflateSync(buf).toString("utf8");
        } catch {
          text = buf.toString("utf8");
        }
      }
      fs.writeFileSync("/tmp/mmd-eas-build-decoded.log", text);
      const lines = text.split(/\r?\n/);
      const re =
        /error|Error|Unable|failed|Module not found|SyntaxError|TypeError|ENOENT|BUNDLE|metro/i;
      const hits = lines.filter((l) => re.test(l));
      console.log(`bytes=${buf.length} decoded=${text.length} hits=${hits.length}`);
      console.log(hits.slice(-120).join("\n"));
    });
  })
  .on("error", (e) => {
    console.error(e);
    process.exit(1);
  });
