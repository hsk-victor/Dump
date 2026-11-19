import { Menu } from "@base-ui/react/menu";
import type { ReactNode } from "react";

export function PhoneMenu({ children, submenu = false }: { children: ReactNode; submenu?: boolean }) {
  return (
    <Menu.Portal>
      <PhoneMenuPositioner submenu={submenu}>{children}</PhoneMenuPositioner>
    </Menu.Portal>
  );
}

function PhoneMenuPositioner({ children, submenu }: { children: ReactNode; submenu: boolean }) {
  return (
    <Menu.Positioner
      className="d-phone-positioner"
      collisionBoundary={document.querySelector(".d-phone-popup-boundary") ?? undefined}
      collisionPadding={4}
      side={submenu ? "top" : "bottom"}
      align="end"
      sideOffset={4}
    >
      <Menu.Popup className="d-menu d-phone-menu">{children}</Menu.Popup>
    </Menu.Positioner>
  );
}
