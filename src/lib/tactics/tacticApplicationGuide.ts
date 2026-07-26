import type { SquadMetadataLookup } from "../fconline/squadProfile";
import type {
  NormalizedMatch,
  PlayerPosition,
  TacticApplicationGuide,
  TacticApplicationGuideSet,
  TacticAssignmentMatchKind,
  TacticInstructionAssignment,
  TacticRecommendation,
  TacticRecommendationSet,
} from "../fconline/types";
import { PLAYER_POSITIONS } from "./tacticSchema";

type InstructionSlot = {
  instructionIndex: number;
  position: PlayerPosition;
};

type ReferenceCandidate = {
  spId: number;
  spGrade: number | null;
  observedPosition: PlayerPosition;
  observedPositionCode: number;
};

type ReferenceLineup = {
  matchId: string;
  playedAt: string | null;
  matchIndex: number;
  candidates: ReferenceCandidate[];
};

type MatchingState = {
  score: number;
  candidateIndexesBySlot: Array<number | null>;
};

const POSITION_FAMILIES = [
  { center: "ST", sides: ["LS", "RS"] },
  { center: "CM", sides: ["LCM", "RCM"] },
  { center: "CDM", sides: ["LDM", "RDM"] },
  { center: "CAM", sides: ["LAM", "RAM"] },
  { center: "CB", sides: ["LCB", "RCB"] },
] as const satisfies ReadonlyArray<{
  center: PlayerPosition;
  sides: readonly PlayerPosition[];
}>;

export function buildTacticApplicationGuideSet(
  recommendation: TacticRecommendationSet,
  matches: NormalizedMatch[],
  metadata: Pick<SquadMetadataLookup, "getPositionName">,
): TacticApplicationGuideSet {
  const referenceLineup = selectReferenceLineup(matches, metadata);

  return {
    primary: buildGuide(recommendation.primary, referenceLineup),
    alternative: buildGuide(recommendation.alternative, referenceLineup),
  };
}

export function getPositionAssignmentMatchKind(
  observedPosition: PlayerPosition,
  targetPosition: PlayerPosition,
): Exclude<TacticAssignmentMatchKind, "unassigned"> | null {
  if (observedPosition === targetPosition) {
    return "exact-recent-position";
  }

  for (const family of POSITION_FAMILIES) {
    if (
      (observedPosition === family.center &&
        family.sides.some((position) => position === targetPosition)) ||
      (targetPosition === family.center &&
        family.sides.some((position) => position === observedPosition))
    ) {
      return "compatible-position";
    }
  }

  return null;
}

function buildGuide(
  recommendation: TacticRecommendation,
  referenceLineup: ReferenceLineup | null,
): TacticApplicationGuide {
  const slots = expandInstructionSlots(recommendation);
  const assignments = referenceLineup
    ? matchCandidatesToSlots(slots, referenceLineup.candidates)
    : slots.map(toUnassignedSlot);

  return {
    recommendationConfigHash: recommendation.metadata.configHash,
    templateId: recommendation.metadata.templateId,
    referenceMatchId: referenceLineup?.matchId ?? null,
    referencePlayedAt: referenceLineup?.playedAt ?? null,
    assignedSlots: assignments.filter((assignment) => assignment.card !== null).length,
    totalSlots: slots.length,
    validation: {
      formation: "unconfirmed",
      personalTactics: "unconfirmed",
    },
    assignments,
  };
}

function selectReferenceLineup(
  matches: NormalizedMatch[],
  metadata: Pick<SquadMetadataLookup, "getPositionName">,
): ReferenceLineup | null {
  let selected: ReferenceLineup | null = null;

  matches.forEach((match, matchIndex) => {
    const candidates = collectReferenceCandidates(match, metadata);

    if (candidates.length === 0) {
      return;
    }

    const candidate = {
      matchId: match.matchId,
      playedAt: match.playedAt,
      matchIndex,
      candidates,
    };

    if (selected === null || isMoreRecent(candidate, selected)) {
      selected = candidate;
    }
  });

  return selected;
}

function collectReferenceCandidates(
  match: NormalizedMatch,
  metadata: Pick<SquadMetadataLookup, "getPositionName">,
) {
  const candidates: ReferenceCandidate[] = [];
  const seenCards = new Set<string>();

  for (const player of match.players) {
    if (player.spPosition === null) {
      continue;
    }

    const observedPosition = toPlayerPosition(metadata.getPositionName(player.spPosition));

    // SUB, GK, 알 수 없는 신규 코드 등 전술 템플릿 슬롯으로 해석할 수 없는 위치는 제외한다.
    if (observedPosition === null) {
      continue;
    }

    const cardKey = createCardKey(player.spId, player.spGrade);

    if (seenCards.has(cardKey)) {
      continue;
    }

    seenCards.add(cardKey);
    candidates.push({
      spId: player.spId,
      spGrade: player.spGrade,
      observedPosition,
      observedPositionCode: player.spPosition,
    });
  }

  return candidates.sort(compareCandidates);
}

function expandInstructionSlots(recommendation: TacticRecommendation): InstructionSlot[] {
  return recommendation.playerInstructions.flatMap((instruction, instructionIndex) =>
    instruction.positions.map((position) => ({ instructionIndex, position })),
  );
}

function matchCandidatesToSlots(
  slots: InstructionSlot[],
  candidates: ReferenceCandidate[],
): TacticInstructionAssignment[] {
  const exactWeight = slots.length + 1;
  let states = new Map<number, MatchingState>([
    [
      0,
      {
        score: 0,
        candidateIndexesBySlot: Array<number | null>(slots.length).fill(null),
      },
    ],
  ]);

  candidates.forEach((candidate, candidateIndex) => {
    const nextStates = new Map(states);

    for (const [mask, state] of states) {
      slots.forEach((slot, slotIndex) => {
        if ((mask & (1 << slotIndex)) !== 0) {
          return;
        }

        const matchKind = getPositionAssignmentMatchKind(
          candidate.observedPosition,
          slot.position,
        );

        if (matchKind === null) {
          return;
        }

        const nextMask = mask | (1 << slotIndex);
        const nextCandidateIndexes = [...state.candidateIndexesBySlot];
        nextCandidateIndexes[slotIndex] = candidateIndex;
        const nextState = {
          score:
            state.score +
            (matchKind === "exact-recent-position" ? exactWeight : 1),
          candidateIndexesBySlot: nextCandidateIndexes,
        };
        const existing = nextStates.get(nextMask);

        if (!existing || isBetterState(nextState, existing, candidates)) {
          nextStates.set(nextMask, nextState);
        }
      });
    }

    states = nextStates;
  });

  const bestState = Array.from(states.values()).reduce((best, candidate) =>
    isBetterState(candidate, best, candidates) ? candidate : best,
  );

  return slots.map((slot, slotIndex) => {
    const candidateIndex = bestState.candidateIndexesBySlot[slotIndex];

    if (candidateIndex === null) {
      return toUnassignedSlot(slot);
    }

    const candidate = candidates[candidateIndex];
    const matchKind = getPositionAssignmentMatchKind(
      candidate.observedPosition,
      slot.position,
    );

    if (matchKind === null) {
      return toUnassignedSlot(slot);
    }

    return {
      instructionIndex: slot.instructionIndex,
      position: slot.position,
      card: { spId: candidate.spId, spGrade: candidate.spGrade },
      observedPosition: candidate.observedPosition,
      observedPositionCode: candidate.observedPositionCode,
      matchKind,
    };
  });
}

function toUnassignedSlot(slot: InstructionSlot): TacticInstructionAssignment {
  return {
    instructionIndex: slot.instructionIndex,
    position: slot.position,
    card: null,
    observedPosition: null,
    observedPositionCode: null,
    matchKind: "unassigned",
  };
}

function isBetterState(
  candidate: MatchingState,
  current: MatchingState,
  candidates: ReferenceCandidate[],
) {
  if (candidate.score !== current.score) {
    return candidate.score > current.score;
  }

  return createStateSignature(candidate, candidates) < createStateSignature(current, candidates);
}

function createStateSignature(state: MatchingState, candidates: ReferenceCandidate[]) {
  return state.candidateIndexesBySlot
    .map((candidateIndex) =>
      candidateIndex === null
        ? "~"
        : createCardKey(
            candidates[candidateIndex].spId,
            candidates[candidateIndex].spGrade,
          ),
    )
    .join("|");
}

function toPlayerPosition(value: string | null): PlayerPosition | null {
  if (value === null) {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return PLAYER_POSITIONS.includes(normalized as PlayerPosition)
    ? (normalized as PlayerPosition)
    : null;
}

function isMoreRecent(candidate: ReferenceLineup, current: ReferenceLineup) {
  const candidateTime = normalizeDate(candidate.playedAt);
  const currentTime = normalizeDate(current.playedAt);

  if (candidateTime !== currentTime) {
    return candidateTime > currentTime;
  }

  return candidate.matchIndex < current.matchIndex;
}

function compareCandidates(left: ReferenceCandidate, right: ReferenceCandidate) {
  return (
    PLAYER_POSITIONS.indexOf(left.observedPosition) -
      PLAYER_POSITIONS.indexOf(right.observedPosition) ||
    left.spId - right.spId ||
    (left.spGrade ?? 0) - (right.spGrade ?? 0)
  );
}

function normalizeDate(value: string | null) {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function createCardKey(spId: number, spGrade: number | null) {
  return `${spId}:${spGrade ?? "unknown"}`;
}
