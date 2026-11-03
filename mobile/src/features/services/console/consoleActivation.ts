/** A request cannot regain authority after its view leaves and returns. */
export function createConsoleActivation(
  readEpoch: () => number,
  initiallyActive: boolean,
) {
  let active = initiallyActive;
  let mounted = true;
  let generation = 0;
  return {
    update(next: boolean) {
      if (active !== next) generation++;
      active = next;
    },
    mount() {
      mounted = true;
    },
    dispose() {
      mounted = false;
      generation++;
    },
    capture() {
      const expected = generation;
      const epoch = readEpoch();
      return () => {
        if (
          !mounted ||
          !active ||
          expected !== generation ||
          epoch !== readEpoch()
        )
          throw new Error(
            "This view changed. Refresh and review before continuing.",
          );
      };
    },
  };
}
