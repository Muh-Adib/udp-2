import type { MetadataRoute } from "next";

/**
 * Ronde 46 — PWA Manifest: UDP CRM dapat dipasang (installable) di
 * Android/iOS/desktop sebagai aplikasi standalone.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "UDP CRM — Multi-Brand Creative Agency Platform",
    short_name: "UDP CRM",
    description:
      "Multi-brand CRM, sales pipeline, finance, project production & client portal untuk Unimasi, Segia Tech, Erfo Multimedia, dan Unicam Studio.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f4f4f5",
    theme_color: "#f97316",
    lang: "id",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
