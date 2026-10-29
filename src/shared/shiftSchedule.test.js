import { getActiveShift, getShiftAssignments, getShiftTeamWarning } from "./shiftSchedule";

describe("six-on, two-off shift rotation", () => {
    test("matches the confirmed team assignments on October 17, 2026", () => {
        expect(getShiftAssignments(new Date(2026, 9, 17))).toEqual({
            morning: "D",
            afternoon: "C",
            night: "B",
        });
    });

    test("hands the resting team's slot to the returning team", () => {
        expect(getShiftAssignments(new Date(2026, 9, 15))).toEqual({
            morning: "A",
            afternoon: "C",
            night: "B",
        });
        expect(getShiftAssignments(new Date(2026, 9, 18))).toEqual({
            morning: "D",
            afternoon: "C",
            night: "A",
        });
        expect(getShiftAssignments(new Date(2026, 9, 20))).toEqual({
            morning: "D",
            afternoon: "B",
            night: "A",
        });
        expect(getShiftAssignments(new Date(2026, 9, 22))).toEqual({
            morning: "C",
            afternoon: "B",
            night: "A",
        });
    });

    test("uses the shift start date for the overnight slot", () => {
        expect(getActiveShift(new Date(2026, 9, 17, 23, 0))).toEqual({
            shift: "B",
            slot: "23:00–07:00",
            date: "2026-10-17",
            workDay: 6,
        });
        expect(getActiveShift(new Date(2026, 9, 18, 6, 59))).toEqual({
            shift: "B",
            slot: "23:00–07:00",
            date: "2026-10-17",
            workDay: 6,
        });
        expect(getActiveShift(new Date(2026, 9, 18, 7, 0))).toEqual({
            shift: "D",
            slot: "07:00–15:00",
            date: "2026-10-18",
            workDay: 3,
        });
    });

    test("starts a new workday count when a shift returns after two rest days", () => {
        expect(getActiveShift(new Date(2026, 9, 28, 8, 0))).toEqual({
            shift: "B",
            slot: "07:00–15:00",
            date: "2026-10-28",
            workDay: 1,
        });
        expect(getActiveShift(new Date(2026, 9, 29, 8, 0)).workDay).toBe(2);
    });

    test("warns but allows login when the account team is not on duty", () => {
        const activeShift = getActiveShift(new Date(2026, 9, 17, 8, 0));

        expect(getShiftTeamWarning("D", activeShift)).toBe("");
        expect(getShiftTeamWarning("A", activeShift)).toContain("assigned team is A");
        expect(getShiftTeamWarning(undefined, activeShift)).toContain("No shift team is assigned");
    });

    test("continues the coverage cycle through later rest periods", () => {
        expect(getShiftAssignments(new Date(2026, 9, 24))).toEqual({
            morning: "C",
            afternoon: "B",
            night: "D",
        });
        expect(getShiftAssignments(new Date(2026, 9, 26))).toEqual({
            morning: "C",
            afternoon: "A",
            night: "D",
        });
    });
});
