import { setRecordedDriverFixSink } from "./driverLocationTracker";
import { flushXlProgress, type XlProgressStorage } from "./xlProgressQueue";
import { recordXlGpsFix, setXlProgressFlush } from "./xlProgressRecord";

export {
  readActiveXlDeparture,
  recordXlDriverAction,
  recordXlGpsFix,
  rememberActiveXlDeparture,
  type XlActiveDeparture,
} from "./xlProgressRecord";

export function installXlGpsCapture(storage: XlProgressStorage, send: Parameters<typeof flushXlProgress>[1]) {
  setXlProgressFlush(send);
  setRecordedDriverFixSink((fix) => {
    void recordXlGpsFix(storage, fix).catch(() => undefined);
  });
}
