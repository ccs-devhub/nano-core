import type { ReactElement, ReactNode } from 'react';
import { createContext, useContext, useState } from 'react';

/**
 * Cross-view UI state: while a text input is capturing keystrokes the
 * global navigation keys (1-5, q) must stay inert.
 */
interface UiStateValue {
  editing: boolean;
  setEditing: (editing: boolean) => void;
}

const UiStateContext = createContext<UiStateValue>({
  editing: false,
  setEditing: (): void => {},
});

export function UiStateProvider(
  { children }: { children: ReactNode }
): ReactElement {
  const [editing, set_editing] = useState(false);

  return (
    <UiStateContext.Provider
      value={{
        editing,
        setEditing: (value: boolean): void => {
          set_editing(value);
        },
      }}
    >
      {children}
    </UiStateContext.Provider>
  );
}

export function useUiState(): UiStateValue {
  return useContext(UiStateContext);
}
