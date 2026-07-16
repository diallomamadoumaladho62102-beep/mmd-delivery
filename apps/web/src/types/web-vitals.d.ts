declare module "web-vitals" {
  type Metric = { name: string; value: number };
  type ReportHandler = (metric: Metric) => void;
  export function onLCP(onReport: ReportHandler): void;
  export function onINP(onReport: ReportHandler): void;
  export function onCLS(onReport: ReportHandler): void;
  export function onTTFB(onReport: ReportHandler): void;
  export function onFCP(onReport: ReportHandler): void;
}
