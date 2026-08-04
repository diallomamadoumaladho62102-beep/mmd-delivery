import type { ReactNode } from "react";
import Footer from "@/components/Footer";

export default function SellerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="min-h-[calc(100vh-8rem)]">{children}</div>
      <Footer />
    </div>
  );
}
