import { RouteJsonLd } from "@/components/BreadcrumbJsonLd";
import { routeMetadata } from "@/app/seo-routes";

export const metadata = routeMetadata("whirlpool");

export default function WhirlpoolLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <RouteJsonLd route="whirlpool" />
      {children}
    </>
  );
}
