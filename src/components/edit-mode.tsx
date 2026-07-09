"use client";
import { createContext, useContext, useState, type ReactNode } from "react";

const EditModeContext = createContext<{ editing: boolean; toggle: () => void }>({ editing: false, toggle: () => {} });

export function EditModeProvider({ children }: { children: ReactNode }) {
  const [editing, setEditing] = useState(false);
  return <EditModeContext.Provider value={{ editing, toggle: () => setEditing((v) => !v) }}>{children}</EditModeContext.Provider>;
}

export const useEditMode = () => useContext(EditModeContext);
