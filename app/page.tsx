import Graph from "./graph";
import { Toaster } from "@/components/ui/toaster";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col">
      <Graph />
      <Toaster />
    </main>
  );
}
