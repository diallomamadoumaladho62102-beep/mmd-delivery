import { registerRootComponent } from "expo";
import App from "./apps/mobile/App";
import { AppErrorBoundary } from "./apps/mobile/src/components/AppErrorBoundary";
import { logStartupProbe } from "./apps/mobile/src/lib/startupProbe";

logStartupProbe("index-loaded");

function RootApp() {
  return (
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  );
}

registerRootComponent(RootApp);
