export type PitchCoordinate = {
  left: number;
  top: number;
};

export type PitchPlacement<T> = PitchCoordinate & {
  item: T;
};

const PITCH_GRID_COLUMNS = [12, 31, 50, 69, 88] as const;
const PITCH_GRID_ROWS = [10, 26, 42, 58, 74, 90] as const;

const PITCH_GRID_SLOTS: ReadonlyArray<PitchCoordinate> = PITCH_GRID_ROWS.flatMap((top) =>
  PITCH_GRID_COLUMNS.map((left) => ({ left, top })),
);

export function createPitchPlacements<T>(
  items: T[],
  readPosition: (item: T) => PitchCoordinate,
): PitchPlacement<T>[] {
  const availableSlots = PITCH_GRID_SLOTS.map((slot) => ({ ...slot }));

  return items.map((item) => {
    const preferredPosition = readPosition(item);
    let nearestSlotIndex = 0;
    let nearestSlotDistance = Number.POSITIVE_INFINITY;

    for (const [index, slot] of availableSlots.entries()) {
      const horizontalDistance = slot.left - preferredPosition.left;
      const verticalDistance = slot.top - preferredPosition.top;
      const distance = horizontalDistance ** 2 + verticalDistance ** 2;

      if (distance < nearestSlotDistance) {
        nearestSlotIndex = index;
        nearestSlotDistance = distance;
      }
    }

    const [slot] = availableSlots.splice(nearestSlotIndex, 1);

    return {
      item,
      left: slot?.left ?? preferredPosition.left,
      top: slot?.top ?? preferredPosition.top,
    };
  });
}
