# inflight (MMD vendor)

Local replacement for npm `inflight@1.0.6`, the only registry release. That release is deprecated and vulnerable to `SNYK-JS-INFLIGHT-6095116` (CWE-772): a request that is never completed stays in the module-level `reqs` map forever.

`glob@7.2.3` (React Native 0.81 codegen, `react-native`, `rimraf@3`, Jest `test-exclude`) calls `inflight(key, cb)` and, when the return value is non-null, passes it to `fs`. Joining an in-flight call still returns `null`. Completing the call still runs every queued callback and deletes the slot.

The additional release path: the function returned to the caller is registered with `FinalizationRegistry`. If that function is dropped without being called, the pending slot is deleted. `glob@7` is not replaced, so Metro and the React Native codegen keep the callback API.
