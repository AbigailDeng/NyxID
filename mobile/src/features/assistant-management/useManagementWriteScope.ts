import { useEffect, useRef } from "react";
import { AppState } from "react-native";

/** A write's authority never recovers after its page loses activation. */
export function useManagementWriteScope(active: boolean) {
  const scope = useRef({ active, mounted: false, generation: 0 });
  if (scope.current.active && !active) scope.current.generation++;
  scope.current.active = active;
  useEffect(() => {
    scope.current.mounted = true;
    // Observe backgrounding immediately, before the runtime's state update
    // commits. Returning to the foreground cannot revive a captured guard.
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") scope.current.generation++;
    });
    return () => {
      scope.current.mounted = false;
      scope.current.generation++;
      subscription.remove();
    };
  }, []);
  return {
    isMounted: () => scope.current.mounted,
    capture: () => {
      const generation = scope.current.generation;
      return () => {
        if (
          !scope.current.mounted ||
          !scope.current.active ||
          generation !== scope.current.generation
        )
          throw new Error(
            "This save was interrupted. Reload and review before trying again.",
          );
      };
    },
  };
}
