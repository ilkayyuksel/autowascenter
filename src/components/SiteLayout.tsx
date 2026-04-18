import type { ReactNode } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { FloatingContactBar } from "./FloatingContactBar";
import { MobileStickyCTA } from "./MobileStickyCTA";

export function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 pb-24 sm:pb-0">{children}</main>
      <Footer />
      <FloatingContactBar />
      <MobileStickyCTA />
    </div>
  );
}
