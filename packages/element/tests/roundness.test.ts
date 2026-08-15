import {
  DEFAULT_ADAPTIVE_RADIUS,
  DEFAULT_PROPORTIONAL_RADIUS,
  ROUNDNESS,
  SOFT_ADAPTIVE_RADIUS,
  SOFT_PROPORTIONAL_RADIUS,
} from "@excalidraw/common";

import {
  getRoundnessForElementType,
  getStrokeRoundness,
} from "../src/typeChecks";
import { getCornerRadius } from "../src/utils";

import type { ExcalidrawElement } from "../src/types";

const rect = (
  roundness: ExcalidrawElement["roundness"],
): Pick<ExcalidrawElement, "roundness"> => ({ roundness });

describe("soft edge roundness", () => {
  it("maps stroke styles to the matching roundness payload", () => {
    expect(getRoundnessForElementType("rectangle", "sharp")).toBeNull();
    expect(getRoundnessForElementType("rectangle", "round")).toEqual({
      type: ROUNDNESS.ADAPTIVE_RADIUS,
    });
    expect(getRoundnessForElementType("rectangle", "soft")).toEqual({
      type: ROUNDNESS.ADAPTIVE_RADIUS,
      value: SOFT_ADAPTIVE_RADIUS,
    });
    expect(getRoundnessForElementType("diamond", "soft")).toEqual({
      type: ROUNDNESS.PROPORTIONAL_RADIUS,
      value: SOFT_PROPORTIONAL_RADIUS,
    });
  });

  it("detects soft vs round vs sharp from stored roundness", () => {
    expect(getStrokeRoundness(null)).toBe("sharp");
    expect(getStrokeRoundness({ type: ROUNDNESS.ADAPTIVE_RADIUS })).toBe(
      "round",
    );
    expect(
      getStrokeRoundness({
        type: ROUNDNESS.ADAPTIVE_RADIUS,
        value: SOFT_ADAPTIVE_RADIUS,
      }),
    ).toBe("soft");
    expect(
      getStrokeRoundness({
        type: ROUNDNESS.PROPORTIONAL_RADIUS,
        value: SOFT_PROPORTIONAL_RADIUS,
      }),
    ).toBe("soft");
  });

  it("keeps default adaptive radius unchanged", () => {
    const element = rect({ type: ROUNDNESS.ADAPTIVE_RADIUS });
    expect(getCornerRadius(200, element as ExcalidrawElement)).toBe(
      DEFAULT_ADAPTIVE_RADIUS,
    );
    expect(getCornerRadius(80, element as ExcalidrawElement)).toBe(
      80 * DEFAULT_PROPORTIONAL_RADIUS,
    );
  });

  it("uses a smaller radius for soft adaptive corners", () => {
    const element = rect({
      type: ROUNDNESS.ADAPTIVE_RADIUS,
      value: SOFT_ADAPTIVE_RADIUS,
    });
    expect(getCornerRadius(200, element as ExcalidrawElement)).toBe(
      SOFT_ADAPTIVE_RADIUS,
    );
    expect(getCornerRadius(80, element as ExcalidrawElement)).toBe(
      80 *
        DEFAULT_PROPORTIONAL_RADIUS *
        (SOFT_ADAPTIVE_RADIUS / DEFAULT_ADAPTIVE_RADIUS),
    );
  });

  it("uses a smaller ratio for soft proportional corners", () => {
    const element = rect({
      type: ROUNDNESS.PROPORTIONAL_RADIUS,
      value: SOFT_PROPORTIONAL_RADIUS,
    });
    expect(getCornerRadius(100, element as ExcalidrawElement)).toBe(
      100 * SOFT_PROPORTIONAL_RADIUS,
    );
  });
});
