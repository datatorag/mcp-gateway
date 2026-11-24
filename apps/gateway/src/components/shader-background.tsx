"use client";

import { MeshGradient } from "@paper-design/shaders-react";
import type React from "react";

interface ShaderBackgroundProps {
  children: React.ReactNode;
}

export function ShaderBackground({ children }: ShaderBackgroundProps) {
  return (
    // The height is the content's (SCRUM-507). It used to carry `min-h-screen`,
    // which made the section as tall as the window: on a tall window that left
    // an empty band of background under the last thing in it. The shaders are
    // `absolute inset-0`, so they fill whatever height the content gives.
    <div className="relative overflow-hidden bg-[#0a1628]">
      {/* Background Shaders */}
      <MeshGradient
        className="absolute inset-0 w-full h-full"
        colors={["#0a1628", "#1a3a8f", "#2D5BD6", "#1e2d5e", "#4a7aff"]}
        speed={0.3}
      />
      <MeshGradient
        className="absolute inset-0 w-full h-full opacity-40"
        colors={["#0a1628", "#ffffff", "#2D5BD6", "#000000"]}
        speed={0.2}
      />
      {children}
    </div>
  );
}
