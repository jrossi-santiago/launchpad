import { redirect } from "next/navigation";

// The queue lives inside Commenter now.
export default function Page() {
  redirect("/commenter/queue");
}
