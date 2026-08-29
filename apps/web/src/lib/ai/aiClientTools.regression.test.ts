import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLIENT_TOOL_NAMES } from "./tools/registry";
import { guardSensitiveAiTool } from "./tools/guardSensitiveAiTool";
import { isBlockedAutoAction } from "./aiSafety";
import { PUBLIC_HELP_SLUGS } from "./searchMmdHelp";

const here = path.dirname(fileURLToPath(import.meta.url));

assert.ok(CLIENT_TOOL_NAMES.includes("quote_taxi"));
assert.ok(CLIENT_TOOL_NAMES.includes("prepare_taxi_booking"));
assert.ok(CLIENT_TOOL_NAMES.includes("get_restaurant_menu"));
assert.ok(CLIENT_TOOL_NAMES.includes("quote_food_order"));
assert.ok(CLIENT_TOOL_NAMES.includes("prepare_food_order"));
assert.ok(CLIENT_TOOL_NAMES.includes("search_mmd_help"));
assert.ok(CLIENT_TOOL_NAMES.includes("search_places"));
assert.ok(CLIENT_TOOL_NAMES.includes("get_recent_taxi_rides"));

assert.equal(isBlockedAutoAction("confirm_paid"), true);
assert.equal(isBlockedAutoAction("create_taxi_ride"), true);
assert.equal(isBlockedAutoAction("place_order"), true);
assert.equal(isBlockedAutoAction("cash_out"), true);
assert.equal(isBlockedAutoAction("quote_taxi"), false);
assert.equal(isBlockedAutoAction("search_mmd_help"), false);
assert.equal(isBlockedAutoAction("search_places"), false);

const blocked = guardSensitiveAiTool("confirm_paid");
assert.equal(blocked?.blocked, true);
assert.equal(guardSensitiveAiTool("quote_taxi"), null);

const taxiSrc = fs.readFileSync(path.join(here, "tools/client/taxiTools.ts"), "utf8");
assert.match(taxiSrc, /route: "TaxiHome"/);
assert.doesNotMatch(taxiSrc, /route: "#"/);
assert.match(taxiSrc, /requiresConfirmation: true/);
assert.doesNotMatch(taxiSrc, /create-taxi-quote-checkout-session/);
assert.doesNotMatch(taxiSrc, /confirm-taxi-paid/);
assert.doesNotMatch(taxiSrc, /payouts\.create/);

const foodSrc = fs.readFileSync(path.join(here, "tools/client/foodTools.ts"), "utf8");
assert.match(foodSrc, /quoteFoodOrderServerSide/);
assert.match(foodSrc, /restaurant_items/);
assert.match(foodSrc, /items,/);
const registrySrc = fs.readFileSync(path.join(here, "tools/registry.ts"), "utf8");
assert.match(registrySrc, /prepare_food_order[\s\S]*items:/);
assert.doesNotMatch(foodSrc, /create-food-quote-checkout-session/);
assert.doesNotMatch(foodSrc, /confirm-paid/);

const helpSrc = fs.readFileSync(path.join(here, "searchMmdHelp.ts"), "utf8");
assert.match(helpSrc, /listPublishedFaq/);
assert.match(helpSrc, /getPublishedPageBySlug/);
assert.doesNotMatch(helpSrc, /support-runbook/);
assert.doesNotMatch(helpSrc, /operations-runbook/);
assert.ok(PUBLIC_HELP_SLUGS.includes("faq"));
assert.ok(PUBLIC_HELP_SLUGS.includes("how-it-works"));

const agentSrc = fs.readFileSync(path.join(here, "aiAgent.ts"), "utf8");
assert.match(agentSrc, /isBlockedAutoAction/);
assert.match(agentSrc, /evaluateAiContentPolicy/);
assert.match(agentSrc, /result\.requiresConfirmation/);
assert.match(agentSrc, /search_places|sanitizeAssistantOutput/);

const ctxExists = fs.existsSync(path.join(here, "contexts/buildClientContext.ts"));
const missionExists = fs.existsSync(path.join(here, "contexts/buildSharedMissionContext.ts"));
assert.equal(ctxExists, true);
assert.equal(missionExists, true);

console.log("aiClientTools.regression.test.ts OK");
