import { Suspense } from "react";
import DumpApp from "@/components/DumpApp";

export default function Home() {
  return (
    <Suspense>
      <DumpApp />
    </Suspense>
  );
}
