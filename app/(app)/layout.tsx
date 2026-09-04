import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/Sidebar";
import { TabBar } from "@/components/TabBar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("email, plan")
    .eq("id", user.id)
    .single();

  const email = profile?.email ?? user.email ?? "";
  const plan = profile?.plan ?? "free";

  return (
    <div className="flex flex-1">
      <Sidebar email={email} plan={plan} />
      {/* The bottom padding is what keeps the last card clear of the
          mobile tab bar, which is fixed and floats over the page. */}
      <main className="flex flex-1 flex-col overflow-y-auto p-4 pb-28 md:p-8 md:pb-8">
        {children}
      </main>
      <TabBar />
    </div>
  );
}
