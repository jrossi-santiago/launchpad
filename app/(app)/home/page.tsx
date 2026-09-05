import { redirect } from "next/navigation";

// The brand pack moved under You.
export default function Page() {
  redirect("/you/brand-pack");
}
