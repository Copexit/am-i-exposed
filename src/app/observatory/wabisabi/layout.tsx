import { RouteJsonLd } from "@/components/BreadcrumbJsonLd";
import { routeMetadata } from "@/app/seo-routes";

export const metadata = routeMetadata("wabisabi");

export default function WabiSabiLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <RouteJsonLd route="wabisabi" />
      {children}
    </>
  );
}
