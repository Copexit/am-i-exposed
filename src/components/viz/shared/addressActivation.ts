import type { KeyboardEvent } from "react";

/** Click + Enter/Space handlers that open an address node's scan (no-op without an address or handler). */
export function addressActivationProps(
  address: string | undefined,
  onAddressClick: ((address: string) => void) | undefined,
) {
  const activate = () => {
    if (address && onAddressClick) onAddressClick(address);
  };
  return {
    onClick: activate,
    onKeyDown: (e: KeyboardEvent) => {
      if ((e.key === "Enter" || e.key === " ") && address && onAddressClick) {
        e.preventDefault();
        activate();
      }
    },
  };
}
