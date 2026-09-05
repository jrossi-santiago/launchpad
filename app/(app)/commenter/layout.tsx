import { CommenterNav } from "@/components/commenter/CommenterNav";

// Both Commenter views share the segmented header, so it lives here rather
// than being repeated (and drifting) in each page.
export default function CommenterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <CommenterNav />
      {children}
    </div>
  );
}
