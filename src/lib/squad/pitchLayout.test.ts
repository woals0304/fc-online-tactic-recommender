import { describe, expect, it } from "vitest";

import { createPitchPlacements, type PitchCoordinate } from "./pitchLayout";

type TestPosition = PitchCoordinate & {
  id: string;
};

describe("createPitchPlacements", () => {
  it("keeps distinct preferred grid positions unchanged", () => {
    const positions: TestPosition[] = [
      { id: "GK", left: 50, top: 90 },
      { id: "LB", left: 12, top: 74 },
      { id: "LCB", left: 31, top: 74 },
      { id: "RCB", left: 69, top: 74 },
      { id: "RB", left: 88, top: 74 },
      { id: "LDM", left: 31, top: 58 },
      { id: "RDM", left: 69, top: 58 },
      { id: "LW", left: 12, top: 10 },
      { id: "ST", left: 50, top: 10 },
      { id: "RW", left: 88, top: 10 },
    ];

    const placements = createPitchPlacements(positions, (position) => position);

    expect(placements.map(({ left, top }) => ({ left, top }))).toEqual(
      positions.map(({ left, top }) => ({ left, top })),
    );
  });

  it("allocates shared and duplicated positions to separate safe slots", () => {
    const positions: TestPosition[] = [
      { id: "SW", left: 50, top: 74 },
      { id: "CB", left: 50, top: 74 },
      { id: "RWB", left: 88, top: 74 },
      { id: "RB", left: 88, top: 74 },
      { id: "RAM", left: 69, top: 26 },
      { id: "RF", left: 69, top: 26 },
      { id: "CAM", left: 50, top: 26 },
      { id: "CF", left: 50, top: 26 },
      { id: "LAM", left: 31, top: 26 },
      { id: "LF", left: 31, top: 26 },
      { id: "CF duplicate", left: 50, top: 26 },
    ];

    const placements = createPitchPlacements(positions, (position) => position);
    const occupiedSlots = new Set(
      placements.map(({ left, top }) => `${left}:${top}`),
    );

    expect(occupiedSlots.size).toBe(positions.length);

    for (const [index, placement] of placements.entries()) {
      for (const other of placements.slice(index + 1)) {
        const horizontalDistance = Math.abs(placement.left - other.left);
        const verticalDistance = Math.abs(placement.top - other.top);

        expect(horizontalDistance >= 19 || verticalDistance >= 16).toBe(true);
      }
    }
  });
});
