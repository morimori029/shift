import { Suspense } from "react";
import type { ReactNode } from "react";
import AppShell from "@/components/AppShell";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
