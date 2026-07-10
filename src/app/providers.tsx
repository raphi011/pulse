"use client";
import "@/modules/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { AutoRefreshProvider } from "@/components/auto-refresh-context";
import { ToastProvider } from "@/components/toast-context";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
  }));
  return (
    <QueryClientProvider client={client}>
      <AutoRefreshProvider>
        <ToastProvider>{children}</ToastProvider>
      </AutoRefreshProvider>
    </QueryClientProvider>
  );
}
