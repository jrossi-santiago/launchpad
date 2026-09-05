import { redirect } from "next/navigation";

// Leads moved under You.
export default function Page() {
  redirect("/you/leads");
}
