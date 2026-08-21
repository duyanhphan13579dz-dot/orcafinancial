"use client";

import type { ReactNode } from "react";
import { ProtectedPage } from "@/components/ProtectedPage";

export default function HeatmapLayout({ children }: { children: ReactNode }) {
  return <ProtectedPage featureName="heatmap cổ phiếu">{children}</ProtectedPage>;
}
