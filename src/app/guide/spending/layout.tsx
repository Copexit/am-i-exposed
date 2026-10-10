import { RouteJsonLd } from "@/components/BreadcrumbJsonLd";
import { routeMetadata } from "@/app/seo-routes";

export const metadata = routeMetadata("spending");

export default function SpendingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <RouteJsonLd route="spending" />
      {children}
    </>
  );
}
