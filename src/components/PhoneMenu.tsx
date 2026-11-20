import { Menu } from "@base-ui/react/menu";
import { createContext, useContext, useState, type ReactNode } from "react";

const KeyboardOpen = createContext(false);

export function isKeyboardMenuOpen({ reason, event }: Pick<Menu.Root.ChangeEventDetails, "reason" | "event">) {
  return reason === "list-navigation" ||
    ((reason === "trigger-press" || reason === "item-press") && "detail" in event && event.detail === 0);
}

export function PhoneMenuRoot({ children, submenu = false }: { children: ReactNode; submenu?: boolean }) {
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const Root = submenu ? Menu.SubmenuRoot : Menu.Root;
  return (
    <KeyboardOpen.Provider value={keyboardOpen}>
      <Root onOpenChange={(open, details) => setKeyboardOpen(open && isKeyboardMenuOpen(details))}>
        {children}
      </Root>
    </KeyboardOpen.Provider>
  );
}

export function PhoneMenu({ children, submenu = false }: { children: ReactNode; submenu?: boolean }) {
  return (
    <Menu.Portal>
      <PhoneMenuPositioner submenu={submenu}>{children}</PhoneMenuPositioner>
    </Menu.Portal>
  );
}

function PhoneMenuPositioner({ children, submenu }: { children: ReactNode; submenu: boolean }) {
  const keyboardOpen = useContext(KeyboardOpen);
  return (
    <Menu.Positioner
      className="d-phone-positioner"
      collisionBoundary={document.querySelector(".d-phone-popup-boundary") ?? undefined}
      collisionPadding={4}
      side={submenu ? "top" : "bottom"}
      align="end"
      sideOffset={4}
    >
      <Menu.Popup className="d-menu d-phone-menu" data-keyboard-open={keyboardOpen || undefined}>
        {children}
      </Menu.Popup>
    </Menu.Positioner>
  );
}
