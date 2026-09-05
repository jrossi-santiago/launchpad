import type { MetadataRoute } from "next";

// Makes Launchpad installable to a phone's home screen. `standalone` is
// the point of it: opened from the home screen there is no browser chrome,
// no address bar eating 60px of a 620px screen, and the bottom tab bar
// sits where a native app's would.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Launchpad",
    short_name: "Launchpad",
    description: "Find your next customers on X, before your competitors do.",
    start_url: "/feed",
    display: "standalone",
    background_color: "#18181b",
    theme_color: "#18181b",
    icons: [
      {
        src: "/icon-180.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
