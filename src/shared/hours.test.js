import { HOUR_COUNT, normalizeHours } from "./hours";

describe("normalizeHours", () => {
    test("preserves values from arrays and pads to eight hours", () => {
        expect(normalizeHours([4, "7"])).toEqual([4, 7, 0, 0, 0, 0, 0, 0]);
    });

    test("restores sparse Firebase hour objects by numeric key", () => {
        expect(normalizeHours({ 0: 3, 3: "12", 7: 6 })).toEqual([
            3, 0, 0, 12, 0, 0, 0, 6,
        ]);
    });

    test("returns empty hours for invalid values and ignores invalid entries", () => {
        expect(normalizeHours(null)).toEqual(Array(HOUR_COUNT).fill(0));
        expect(normalizeHours({ 2: "not a number" })).toEqual([
            0, 0, 0, 0, 0, 0, 0, 0,
        ]);
    });
});
