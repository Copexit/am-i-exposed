import { BreadcrumbJsonLd } from "@/components/BreadcrumbJsonLd";
import { ObservatoryPage } from "@/components/observatory/ObservatoryPage";

export default function Page() {
  return (
    <>
      <BreadcrumbJsonLd name="CoinJoin Observatory" path="/observatory/" />
      <ObservatoryPage />
    </>
  );
}
