import { BreadcrumbJsonLd } from "@/components/BreadcrumbJsonLd";
import { GuidePage } from "@/components/guide/GuidePage";

export default function Page() {
  return (
    <>
      <BreadcrumbJsonLd name="Privacy Guide" path="/guide/" />
      <GuidePage />
    </>
  );
}
