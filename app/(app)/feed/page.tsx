import { redirect } from "next/navigation";

// Feed is the Commenter tab now.
export default function Page() {
  redirect("/commenter");
}
