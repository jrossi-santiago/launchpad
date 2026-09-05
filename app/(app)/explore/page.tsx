import { redirect } from "next/navigation";

// Explore is sunset — see docs/sunset/radar-explore.md.
export default function Page() {
  redirect("/heatcheck");
}
