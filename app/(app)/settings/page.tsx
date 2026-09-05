import { redirect } from "next/navigation";

// Settings is the You tab now.
export default function Page() {
  redirect("/you");
}
