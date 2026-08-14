import { useCallback, useEffect, useRef } from "react";
import { Alert } from "react-native";
import i18n from "../i18n";
import {
  ackPrintJob,
  fetchPendingPrintJobs,
  fetchRestaurantAutomationSettings,
} from "../lib/restaurantOrderAutomationApi";
import { printRestaurantTicketSafe } from "../lib/restaurantPrintService";

export function useRestaurantAutoPrint(enabled: boolean) {
  const busyRef = useRef(false);

  const processQueue = useCallback(async () => {
    if (!enabled || busyRef.current) return;
    busyRef.current = true;

    try {
      const settings = await fetchRestaurantAutomationSettings();
      if (!settings.settings.auto_print_enabled) return;

      const jobs = await fetchPendingPrintJobs();
      for (const job of jobs) {
        const jobId = String(job.id ?? "");
        if (!jobId) continue;

        await ackPrintJob(jobId, "printing");

        const payload = job.payload as Record<string, unknown>;
        const result = await printRestaurantTicketSafe(
          payload as any,
          Number(job.copies ?? settings.settings.print_copies ?? 1),
        );

        if (result.ok) {
          await ackPrintJob(jobId, "printed");
        } else if (result.ok === false) {
          await ackPrintJob(jobId, "failed", result.error);
          Alert.alert(
            i18n.t("restaurant.autoPrint.title", "Print"),
            i18n.t(
              "restaurant.autoPrint.failedBody",
              "Order accepted, but printing failed. You can reprint from the order.",
            ),
          );
        }
      }
    } catch (error) {
      console.log("auto print queue error:", error);
    } finally {
      busyRef.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    void processQueue();
    const timer = setInterval(() => {
      void processQueue();
    }, 5000);
    return () => clearInterval(timer);
  }, [enabled, processQueue]);

  return { processQueue };
}
